// ============================================================================
// PaginaToto — Edge Function "admin-users"
// Permite que SOLO el administrador cree / desactive / borre usuarios desde
// la app (la "llave de administrador" vive acá, nunca en la página).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Siempre respondemos 200 y marcamos los errores lógicos con { error }.
// (El cliente de Supabase esconde el cuerpo cuando el status no es 2xx.)
function json(obj: unknown, _status = 200) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // 1) ¿quién llama?
    const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await asUser.auth.getUser();
    if (uErr || !user) return json({ error: "No autenticado" }, 401);

    // 2) ¿es admin activo?
    const admin = createClient(url, service);
    const { data: me } = await admin.from("profiles").select("role, activo").eq("id", user.id).single();
    if (!me || !me.activo || me.role !== "admin") {
      return json({ error: "Solo el administrador puede hacer esto." }, 403);
    }

    const body = await req.json();
    const action = String(body.action ?? "");

    if (action === "list") {
      const { data } = await admin
        .from("profiles")
        .select("id,email,nombre,role,activo,created_at")
        .order("created_at");
      return json({ users: data ?? [] });
    }

    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const nombre = String(body.nombre ?? "").trim();
      const role = body.role === "admin" ? "admin" : "usuario";
      if (!email || password.length < 6) {
        return json({ error: "Poné un email y una contraseña de 6 caracteres o más." }, 400);
      }
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { nombre },
      });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").upsert(
        { id: created.user.id, email, nombre, role, activo: true },
        { onConflict: "id" },
      );
      return json({ ok: true, id: created.user.id });
    }

    if (action === "setActive") {
      if (body.id === user.id) return json({ error: "No te podés desactivar a vos mismo." }, 400);
      await admin.from("profiles").update({ activo: !!body.activo }).eq("id", body.id);
      return json({ ok: true });
    }

    if (action === "setRole") {
      if (body.id === user.id) return json({ error: "No te podés cambiar el rol a vos mismo." }, 400);
      await admin.from("profiles").update({ role: body.role === "admin" ? "admin" : "usuario" }).eq("id", body.id);
      return json({ ok: true });
    }

    if (action === "setPassword") {
      const password = String(body.password ?? "");
      if (password.length < 6) return json({ error: "La contraseña tiene que tener 6 caracteres o más." }, 400);
      const { error } = await admin.auth.admin.updateUserById(body.id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "delete") {
      if (body.id === user.id) return json({ error: "No te podés borrar a vos mismo." }, 400);
      const { error } = await admin.auth.admin.deleteUser(body.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Acción desconocida." }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
