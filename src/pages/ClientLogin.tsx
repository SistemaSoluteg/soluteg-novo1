import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { LogIn, AlertCircle } from "lucide-react";
import { APP_LOGO } from "@/const";
import { toast } from "sonner";

export default function ClientLogin() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Carregar apenas o nome de usuário salvo (senha NUNCA é salva no localStorage)
  useEffect(() => {
    const savedUsername = localStorage.getItem("rememberedUsername");
    // Limpar senha salva de versões anteriores (segurança)
    localStorage.removeItem("rememberedPassword");
    if (savedUsername) {
      setUsername(savedUsername);
      setRememberMe(true);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/client-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Erro ao fazer login");
        toast.error(data.error || "Credenciais inválidas");
        return;
      }

      const data = await response.json();
      
      // Verificar se o cliente tem acesso ao portal
      if (data.type === "sem_portal") {
        setError("Este cliente não tem acesso ao portal");
        toast.error("Este cliente não tem acesso ao portal");
        return;
      }
      
      localStorage.setItem("clientId", data.clientId.toString());
      localStorage.setItem("clientName", data.name);
      localStorage.setItem("clientToken", data.token);
      localStorage.setItem("clientType", data.type);
      
      // Salvar ou limpar apenas o nome de usuário (nunca salvar senha no localStorage)
      if (rememberMe) {
        localStorage.setItem("rememberedUsername", username);
      } else {
        localStorage.removeItem("rememberedUsername");
      }
      // Limpar senha salva de versões anteriores (segurança)
      localStorage.removeItem("rememberedPassword");
      
      toast.success("Login realizado com sucesso!");
      // Usar window.location.href para garantir navegação completa
      setTimeout(() => {
        window.location.href = "/client/portal";
      }, 500);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Erro ao conectar com o servidor";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      {/* Header — mesma aparência do portal do cliente para consistência visual */}
      <header className="bg-slate-900 text-white shadow-md">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-3">
          <img src={APP_LOGO} alt="Soluteg" className="h-8 object-contain" />
          <div className="leading-tight">
            <p className="font-bold text-sm text-white">Portal do Cliente</p>
            <p className="text-[10px] text-slate-400">JNC Elétrica &amp; Bombas</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex items-center justify-center min-h-[calc(100vh-80px)] px-4 py-8">
        <div className="w-full max-w-md">
          {/* Logo e Título */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Portal do Cliente</h1>
            <p className="text-gray-400">Acesse seus documentos e relatórios</p>
          </div>

          {/* Card de Login */}
          <Card className="border-gray-700 bg-slate-800/50 backdrop-blur">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl text-white">Entrar</CardTitle>
              <CardDescription className="text-gray-400">
                Digite suas credenciais para acessar o portal
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                {/* Erro */}
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-200">{error}</p>
                  </div>
                )}

                {/* Campo de Usuário */}
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-gray-200">
                    Nome de Usuário
                  </Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="Digite seu usuário"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                    className="bg-slate-700/50 border-gray-600 text-white placeholder:text-slate-400 focus:border-amber-500 focus:ring-amber-500"
                    required
                  />
                </div>

                {/* Campo de Senha */}
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-gray-200">
                    Senha
                  </Label>
                  <PasswordInput
                    id="password"
                    placeholder="Digite sua senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    className="bg-slate-700/50 border-gray-600 text-white placeholder:text-slate-400 focus:border-amber-500 focus:ring-amber-500"
                    toggleClassName="text-slate-400 hover:text-white"
                    required
                  />
                </div>

                {/* Checkbox Lembrar Login */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="remember"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                    disabled={isLoading}
                    className="border-gray-600 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                  />
                  <Label htmlFor="remember" className="text-gray-300 font-normal cursor-pointer">
                    Lembrar meu usuário
                  </Label>
                </div>

                {/* Botão de Login */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2.5 gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  {isLoading ? "Entrando..." : "Entrar"}
                </Button>
              </form>

              {/* Mensagem de Ajuda */}
              <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <p className="text-sm text-blue-200">
                  <strong>Não tem acesso?</strong> Entre em contato com o administrador do sistema para criar sua conta.
                </p>
              </div>

              {/* Link para o portal do técnico */}
              {/* Link para o portal do técnico — touch target de 44px mín. para mobile */}
              <div className="mt-4 text-center">
                <a
                  href="/technician/login"
                  className="inline-flex items-center justify-center gap-1 px-4 py-2.5 text-sm text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
                >
                  É técnico? Acesse o Portal do Técnico
                </a>
              </div>
            </CardContent>
          </Card>

          {/* Footer — ano dinâmico para não ficar desatualizado */}
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500">
              © {new Date().getFullYear()} JNC Comércio e Serviços Técnicos. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
