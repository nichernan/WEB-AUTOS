$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$containerName = 'paginatoto-audit-test-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$created = $false

function Invoke-Docker {
  param([string[]]$DockerArgs)
  & docker @DockerArgs
  if ($LASTEXITCODE -ne 0) { throw "Falló docker $($DockerArgs -join ' ') (código $LASTEXITCODE)." }
}

try {
  Invoke-Docker -DockerArgs @('run', '-d', '--name', $containerName, '-e', 'POSTGRES_PASSWORD=test-only', '-e', 'POSTGRES_DB=toto_audit_test', 'postgres:17-alpine', '-c', 'wal_level=logical') | Out-Null
  $created = $true

  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    & docker exec $containerName pg_isready -h 127.0.0.1 -U postgres -d toto_audit_test *> $null
    if ($LASTEXITCODE -eq 0) {
      & docker exec $containerName psql -h 127.0.0.1 -U postgres -d toto_audit_test -c 'select 1' *> $null
      if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'PostgreSQL aislado no inició dentro de 60 segundos.' }

  foreach ($file in @('PRUEBAS-BOOTSTRAP-AISLADO.sql', '2-seguridad-y-recuperacion.sql', '3-endurecer-permisos-auth.sql', '4-kv-generation-guard.sql', '6-respaldos-automaticos-por-cambios.sql', 'PRUEBAS-SEGURIDAD-AISLADAS.sql', 'PRUEBAS-BACKUP-AUTOMATICO-AISLADAS.sql')) {
    $source = Join-Path $scriptRoot $file
    Invoke-Docker -DockerArgs @('cp', $source, "${containerName}:/tmp/$file")
  }
  foreach ($file in @('PRUEBAS-BOOTSTRAP-AISLADO.sql', '2-seguridad-y-recuperacion.sql', '3-endurecer-permisos-auth.sql', '4-kv-generation-guard.sql', '6-respaldos-automaticos-por-cambios.sql', 'PRUEBAS-SEGURIDAD-AISLADAS.sql', 'PRUEBAS-BACKUP-AUTOMATICO-AISLADAS.sql')) {
    Write-Host "Ejecutando $file en $containerName (database=toto_audit_test)"
    Invoke-Docker -DockerArgs @('exec', $containerName, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'toto_audit_test', '-f', "/tmp/$file")
  }
  $fixtureUid = '00000000-0000-4000-8000-000000000099'
  $fixtureGeneration = '00000000-0000-4000-8000-000000000088'
  $raceSetup = "insert into public.profiles(id,email,nombre,role,activo) values ('$fixtureUid','race@example.test','Race fixture','usuario',true); insert into public.app_delivery_state(singleton,generation,label) values (true,'$fixtureGeneration','Concurrent fixture'); insert into public.vehicles(id,data) values ('backup-race-fixture',jsonb_build_object('id','backup-race-fixture','modelo','A','_delivery_generation','$fixtureGeneration')); update app_private.backup_state set dirty_since=clock_timestamp()-interval '11 minutes' where generation='$fixtureGeneration'; select set_config('request.jwt.claim.sub','$fixtureUid',false); select set_config('request.jwt.claim.role','authenticated',false); select public.app_create_verified_snapshot((select revision from app_private.backup_state where generation='$fixtureGeneration'),'Race base','activity',true)->>'status';"
  Invoke-Docker -DockerArgs @('exec', $containerName, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'toto_audit_test', '-c', $raceSetup)
  $expectedRevision = (& docker exec $containerName psql -h 127.0.0.1 -At -U postgres -d toto_audit_test -c "select revision from app_private.backup_state where generation='$fixtureGeneration'") -join ''
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer la revisión de la carrera aislada.' }
  $concurrentWrite = "begin; update public.vehicles set data=jsonb_set(data,'{modelo}',to_jsonb('B'::text)) where id='backup-race-fixture'; select pg_sleep(3); commit;"
  Invoke-Docker -DockerArgs @('exec', '-d', $containerName, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'toto_audit_test', '-c', $concurrentWrite) | Out-Null
  Start-Sleep -Milliseconds 700
  $staleSnapshot = "select set_config('request.jwt.claim.sub','$fixtureUid',false); select set_config('request.jwt.claim.role','authenticated',false); select public.app_create_verified_snapshot($expectedRevision,'Race obsoleta','activity',true)->>'status';"
  $raceResult = (& docker exec $containerName psql -h 127.0.0.1 -At -v ON_ERROR_STOP=1 -U postgres -d toto_audit_test -c $staleSnapshot) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $raceResult -notmatch 'stale') { throw "La carrera no devolvió stale: $raceResult" }
  $snapshotCount = (& docker exec $containerName psql -h 127.0.0.1 -At -U postgres -d toto_audit_test -c "select count(*) from public.app_snapshots where source='activity' and generation='$fixtureGeneration'") -join ''
  if ($LASTEXITCODE -ne 0 -or $snapshotCount -ne '1') { throw "Un snapshot obsoleto fue insertado; cantidad=$snapshotCount" }
  Write-Host 'PASS M: cambio concurrente mientras se guarda un snapshot deja la revisión pendiente y no duplica ni verifica el estado viejo.'
  $restoreTest = Join-Path $scriptRoot 'PRUEBA-RESTAURACION-LOCAL.js'
  & node $restoreTest
  if ($LASTEXITCODE -ne 0) { throw "Falló prueba de restauración local (código $LASTEXITCODE)." }
  $syncTest = Join-Path $scriptRoot 'PRUEBA-SYNC-MASIVO-LOCAL.js'
  & node $syncTest
  if ($LASTEXITCODE -ne 0) { throw "Falló prueba de orden del sync masivo (código $LASTEXITCODE)." }
  $backupTest = Join-Path $scriptRoot 'PRUEBA-BACKUP-DEBOUNCE-LOCAL.js'
  & node $backupTest
  if ($LASTEXITCODE -ne 0) { throw "Falló prueba del debounce y recuperación de backup (código $LASTEXITCODE)." }
  Write-Host 'PASS: integración SQL aislada completada. La base de prueba fue desechada.'
}
finally {
  if ($created) {
    & docker rm -f $containerName *> $null
  }
}
