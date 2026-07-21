import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Eye, EyeOff, HardHat } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginInProgress, setLoginInProgress] = useState(false);
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/dashboard", replace: true });
  }, [loading, navigate, user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginInProgress(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast.error("Giriş başarısız: " + error.message);
      setLoginInProgress(false);
    } else {
      toast.success("Giriş başarılı!");
      window.location.assign("/dashboard");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex justify-center items-center text-yellow-400 font-semibold">
        Sistem kontrol ediliyor...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col justify-center items-center p-6">
      <Card className="w-full max-w-md bg-neutral-900 border-neutral-800">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center mb-4">
            <div className="bg-yellow-400 p-3 rounded-lg flex items-center justify-center">
              <HardHat className="w-8 h-8 text-black" />
            </div>
          </div>
          <CardTitle className="text-2xl font-black text-white tracking-tight">
            NES ENERJİ
          </CardTitle>
          <p className="text-sm text-neutral-400 uppercase tracking-wider font-semibold">
            İş Takip Platformu
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4 pt-4">
            <div>
              <label className="text-sm font-medium text-neutral-300">E-posta</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="ornek@nesenerji.com"
                className="bg-neutral-800 border-neutral-700 text-white mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-neutral-300">Şifre</label>
              <div className="relative mt-1">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="bg-neutral-800 border-neutral-700 text-white pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-bold py-6 text-base mt-4"
              disabled={loginInProgress}
            >
              {loginInProgress ? "Giriş yapılıyor..." : "Giriş Yap"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
