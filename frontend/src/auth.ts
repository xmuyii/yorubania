import { supabase } from "./supabase-client";

export async function login(email: string, password: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Call at the top of any page that requires a signed-in member. Redirects
 * to the login page if there's no active session.
 */
export async function requireSession(): Promise<void> {
  const token = await getAccessToken();
  if (!token) {
    window.location.href = "/index.html";
  }
}
