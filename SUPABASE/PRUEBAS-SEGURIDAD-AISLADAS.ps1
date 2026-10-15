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

  foreach ($file in @('PRUEBAS-BOOTSTRAP-AISLADO.sql', '2-seguridad-y-recuperacion.sql', '3-endurecer-permisos-auth.sql', '4-kv-generation-guard.sql', 'PRUEBAS-SEGURIDAD-AISLADAS.sql')) {
    $source = Join-Path $scriptRoot $file
    Invoke-Docker -DockerArgs @('cp', $source, "${containerName}:/tmp/$file")
  }
  foreach ($file in @('PRUEBAS-BOOTSTRAP-AISLADO.sql', '2-seguridad-y-recuperacion.sql', '3-endurecer-permisos-auth.sql', '4-kv-generation-guard.sql', 'PRUEBAS-SEGURIDAD-AISLADAS.sql')) {
    Write-Host "Ejecutando $file en $containerName (database=toto_audit_test)"
    Invoke-Docker -DockerArgs @('exec', $containerName, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'toto_audit_test', '-f', "/tmp/$file")
  }
  $restoreTest = Join-Path $scriptRoot 'PRUEBA-RESTAURACION-LOCAL.js'
  & node $restoreTest
  if ($LASTEXITCODE -ne 0) { throw "Falló prueba de restauración local (código $LASTEXITCODE)." }
  $syncTest = Join-Path $scriptRoot 'PRUEBA-SYNC-MASIVO-LOCAL.js'
  & node $syncTest
  if ($LASTEXITCODE -ne 0) { throw "Falló prueba de orden del sync masivo (código $LASTEXITCODE)." }
  Write-Host 'PASS: integración SQL aislada completada. La base de prueba fue desechada.'
}
finally {
  if ($created) {
    & docker rm -f $containerName *> $null
  }
}
