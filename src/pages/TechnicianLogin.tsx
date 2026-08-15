import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HardHat, LogIn, AlertCircle } from "lucide-react";
import { APP_LOGO } from "@/const";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function TechnicianLogin() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Verifica silenciosamente se o técnico já está autenticado (cookie ainda válido).
  // Se sim, redireciona para o portal sem exibir o formulário de login.
  // Isso resolve o problema de PWA sempre abrir na tela de login ao reiniciar.
  const meQuery = trpc.technicianPortal.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (meQuery.isSuccess) {
      setLocation("/technician/portal");
    }
  }, [meQuery.isSuccess, setLocation]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/technician-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Erro ao fazer login");
        toast.error(data.message || "Credenciais inválidas");
        return;
      }

      localStorage.setItem("technicianId", data.technicianId.toString());
      localStorage.setItem("technicianName", data.name);
      localStorage.setItem("technicianToken", data.token);

      toast.success("Login realizado com sucesso!");
      setTimeout(() => {
        window.location.href = "/technician/portal";
      }, 400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao conectar com o servidor";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      {/* Header */}
      <header className="bg-black text-white py-4 border-b border-gray-700">
        <div className="container mx-auto px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src={APP_LOGO} alt="JNC Logo" className="h-10" />
            <div className="text-sm">
              <div className="font-semibold">JNC Comércio</div>
              <div className="text-xs text-gray-400">(Soluteg)</div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex items-center justify-center min-h-[calc(100vh-80px)] px-4 py-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="p-4 bg-blue-600/20 rounded-full border border-blue-600/30">
                <HardHat className="w-10 h-10 text-blue-400" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Portal do Técnico</h1>
            <p className="text-gray-400">Acesse suas ordens de serviço</p>
          </div>

          <Card className="border-gray-700 bg-slate-800/50 backdrop-blur">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl text-white">Entrar</CardTitle>
              <CardDescription className="text-gray-400">
                Digite suas credenciais para acessar o portal
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-200">{error}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="username" className="text-gray-200">Nome de Usuário</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="Digite seu usuário"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                    className="bg-slate-700/50 border-gray-600 text-white placeholder:text-gray-500 focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-gray-200">Senha</Label>
                  <PasswordInput
                    id="password"
                    placeholder="Digite sua senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    className="bg-slate-700/50 border-gray-600 text-white placeholder:text-gray-500 focus:border-blue-500 focus:ring-blue-500"
                    toggleClassName="text-slate-400 hover:text-white"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  {isLoading ? "Entrando..." : "Entrar"}
                </Button>
              </form>

              <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <p className="text-sm text-blue-200">
                  <strong>Sem acesso?</strong> Entre em contato com o administrador do sistema.
                </p>
              </div>

              {/* Link para o portal do cliente */}
              <div className="mt-4 text-center">
                <p className="text-sm text-gray-400">
                  É cliente?{" "}
                  <a
                    href="/client/login"
                    className="text-orange-400 hover:text-orange-300 underline underline-offset-2 transition-colors"
                  >
                    Acesse o Portal do Cliente
                  </a>
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500">
              © 2024 JNC Comércio e Serviços Técnicos. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
