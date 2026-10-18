import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRouter } from "@tanstack/react-router";

export type AppRole = "admin" | "technical_office" | "contractor" | "customer";

interface AuthState {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  refreshRole: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

// Çevrimdışı (sahada keşif) için: rol ve oturum cihazda saklanır. İnternet
// yokken oturum yenilenemezse son bilinen oturumla devam edilir; bağlantı
// gelince Supabase oturumu kendiliğinden yeniler.
const ROLE_KEY = "nes-role-cache";
const AUTH_STORAGE_KEY = "sb-nyfocdnlbknxpxbeeapj-auth-token";

function cachedRole(userId: string): AppRole | null {
  try {
    const raw = localStorage.getItem(ROLE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as { userId: string; role: AppRole })
      : null;
    return parsed?.userId === userId ? parsed.role : null;
  } catch {
    return null;
  }
}

function storedSession(): Session | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Session) : null;
    return parsed?.user ? parsed : null;
  } catch {
    return null;
  }
}

const isOffline = () => typeof navigator !== "undefined" && !navigator.onLine;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  async function loadRole(userId: string | undefined) {
    if (!userId) {
      setRole(null);
      return;
    }
    // Role lookup is server-side so an RLS/query error can never silently
    // downgrade a technical-office user to the customer interface.
    const { data, error } = await supabase.rpc("get_my_app_role");
    if (error) {
      const fallback = isOffline() ? cachedRole(userId) : null;
      if (!fallback) console.error("Kullanıcı rolü alınamadı", error);
      setRole(fallback);
      return;
    }
    const next = (data ?? "customer") as AppRole;
    try {
      localStorage.setItem(ROLE_KEY, JSON.stringify({ userId, role: next }));
    } catch {
      // Saklanamazsa yalnız çevrimdışı açılış etkilenir.
    }
    setRole(next);
  }

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // İnternet yokken yenileme başarısızlığı oturumu düşürmesin.
      if (!s && isOffline() && storedSession()) return;
      setSession(s);
      loadRole(s?.user?.id);
      router.invalidate();
    });
    // Çevrimdışıyken Supabase oturum yenilemeyi uzun süre dener; ekran
    // beklemesin diye 4 sn sonra cihazdaki oturumla açılır.
    const sessionPromise = isOffline()
      ? Promise.race([
          supabase.auth.getSession(),
          new Promise<{ data: { session: Session | null } }>((resolve) =>
            setTimeout(() => resolve({ data: { session: null } }), 4000),
          ),
        ])
      : supabase.auth.getSession();
    sessionPromise.then(({ data }) => {
      const session = data.session ?? (isOffline() ? storedSession() : null);
      setSession(session);
      loadRole(session?.user?.id).finally(() => setLoading(false));
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const value: AuthState = {
    user: session?.user ?? null,
    session,
    role,
    loading,
    refreshRole: async () => {
      await loadRole(session?.user?.id);
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
