/**
 * Componente de prompt de instalação do PWA.
 *
 * O browser dispara o evento "beforeinstallprompt" quando o app está elegível
 * para ser instalado na tela inicial do celular. Este componente captura esse
 * evento e exibe um banner discreto no topo do portal do técnico.
 *
 * Fluxo:
 *  1. Usuário abre o portal no celular pela primeira vez
 *  2. Após alguns segundos, o browser dispara "beforeinstallprompt"
 *  3. Este componente exibe o banner: "Instalar app para usar offline"
 *  4. Se o usuário clicar "Instalar" → abre o diálogo nativo de instalação
 *  5. Se o usuário clicar "Agora não" → banner some e não aparece por 30 dias
 *  6. Se o usuário já instalou → banner nunca aparece
 */

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Tempo de espera antes de esconder o banner novamente (30 dias em ms)
const SNOOZE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
// Chave padrão — pode ser sobrescrita via prop para separar técnico e cliente
const DEFAULT_STORAGE_KEY = "pwa_install_dismissed_at";

// Tipo do evento nativo do browser para prompt de instalação PWA
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallPWAPromptProps {
  /** Chave do localStorage para persistir a escolha. Padrão: portal do técnico. */
  storageKey?: string;
  /** Texto do banner. Padrão: "Instalar app para usar offline" */
  label?: string;
}

export default function InstallPWAPrompt({
  storageKey = DEFAULT_STORAGE_KEY,
  label = "Instalar app para usar offline em campo",
}: InstallPWAPromptProps) {
  // Guarda o evento capturado para dispará-lo quando o usuário clicar "Instalar"
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    // Verifica se o usuário já dispensou o banner recentemente
    const dismissedAt = localStorage.getItem(storageKey);
    if (dismissedAt) {
      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      // Ainda está dentro do período de soneca → não mostra
      if (elapsed < SNOOZE_DURATION_MS) return;
    }

    // Escuta o evento do browser que indica que o app pode ser instalado
    const handler = (e: Event) => {
      // Impede que o browser exiba o mini-banner padrão dele mesmo
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisivel(true);
      console.log("[OFFLINE] App elegível para instalação PWA");
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Dispara o diálogo nativo de instalação do SO
  async function handleInstalar() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log("[OFFLINE] Resultado da instalação PWA:", outcome);
    // Independente do resultado, esconde o banner — não faz sentido perguntar de novo
    setDeferredPrompt(null);
    setVisivel(false);
  }

  // Usuário não quer instalar agora — persiste a data para não perguntar por 30 dias
  function handleAgora() {
    localStorage.setItem(storageKey, String(Date.now()));
    setVisivel(false);
    console.log("[OFFLINE] Banner de instalação dispensado pelo usuário");
  }

  // Não renderiza nada se o browser não suporta PWA ou o usuário já dispensou
  if (!visivel) return null;

  return (
    <div
      className="w-full bg-blue-600 text-white px-4 py-2.5 flex items-center gap-3"
      role="banner"
      aria-label="Instalar aplicativo"
    >
      {/* Ícone e texto principal */}
      <Download className="w-4 h-4 flex-shrink-0" />
      <p className="text-sm flex-1 leading-tight">
        <span className="opacity-90">{label}</span>
      </p>

      {/* Botões de ação */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-3 text-xs font-semibold bg-white text-blue-700 hover:bg-blue-50"
          onClick={handleInstalar}
        >
          Instalar
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/10"
          onClick={handleAgora}
          title="Fechar"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
