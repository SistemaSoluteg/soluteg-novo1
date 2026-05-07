/**
 * TechnicianHowOfflineWorks — guia rápido do modo offline para o técnico.
 *
 * Explica de forma simples:
 *   - Como instalar o app na tela inicial
 *   - O que funciona sem internet
 *   - O que precisa de internet
 *   - Como saber se está sincronizado
 */

import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  WifiOff,
  Wifi,
  Smartphone,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  Camera,
  PenLine,
  ClipboardList,
  MessageSquare,
  Activity,
} from "lucide-react";

type Item = { icon: React.ReactNode; label: string; detail?: string };

function Section({ title, color, items }: { title: string; color: string; items: Item[] }) {
  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <p className="text-sm font-semibold mb-3">{title}</p>
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <div className="shrink-0 mt-0.5">{item.icon}</div>
            <div>
              <p className="text-sm">{item.label}</p>
              {item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TechnicianHowOfflineWorks() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3 max-w-2xl">
          <Button size="icon" variant="ghost" onClick={() => setLocation("/technician/portal")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <p className="text-xs text-muted-foreground">Portal do Técnico</p>
            <p className="font-semibold text-sm">Como funciona offline</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-5 max-w-2xl">

        {/* Instalar o app */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Smartphone className="w-5 h-5 text-blue-600" />
            <p className="font-semibold text-blue-900">1. Como instalar o app</p>
          </div>
          <ol className="space-y-2 text-sm text-blue-900">
            <li className="flex gap-2">
              <span className="font-bold shrink-0">①</span>
              Abra o portal no Chrome (Android) ou Safari (iPhone)
            </li>
            <li className="flex gap-2">
              <span className="font-bold shrink-0">②</span>
              Um banner azul vai aparecer: <strong>"Instalar app para usar offline"</strong>
            </li>
            <li className="flex gap-2">
              <span className="font-bold shrink-0">③</span>
              Toque em <strong>Instalar</strong> → confirme na caixa do celular
            </li>
            <li className="flex gap-2">
              <span className="font-bold shrink-0">④</span>
              O ícone <strong>Soluteg</strong> vai aparecer na tela inicial — abra por lá sempre
            </li>
          </ol>
          <div className="mt-3 p-2.5 bg-blue-100 rounded-lg">
            <p className="text-xs text-blue-800">
              <strong>Dica:</strong> faça login pelo menos uma vez com internet para que as OS sejam baixadas. Depois pode entrar no subsolo normalmente.
            </p>
          </div>
        </div>

        {/* O que funciona offline */}
        <Section
          title="✅ O que funciona sem internet"
          color="bg-green-50 border-green-200"
          items={[
            {
              icon: <CheckCircle2 className="w-4 h-4 text-green-600" />,
              label: "Ver suas OS atribuídas",
              detail: "Baixadas automaticamente ao logar",
            },
            {
              icon: <CheckCircle2 className="w-4 h-4 text-green-600" />,
              label: "Alterar status da OS",
              detail: "Iniciar, pausar — Concluir só online",
            },
            {
              icon: <ClipboardList className="w-4 h-4 text-green-600" />,
              label: "Preencher checklists",
              detail: "Dados salvos localmente e enviados ao reconectar",
            },
            {
              icon: <Camera className="w-4 h-4 text-green-600" />,
              label: "Tirar fotos",
              detail: "Salvas no celular, enviadas ao Cloudinary quando voltar online",
            },
            {
              icon: <PenLine className="w-4 h-4 text-green-600" />,
              label: "Assinar (técnico e cliente)",
              detail: "Assinatura salva localmente e sincronizada depois",
            },
            {
              icon: <MessageSquare className="w-4 h-4 text-green-600" />,
              label: "Adicionar comentários/observações",
              detail: "Enviados automaticamente ao reconectar",
            },
          ]}
        />

        {/* O que precisa de internet */}
        <Section
          title="🌐 O que precisa de internet"
          color="bg-orange-50 border-orange-200"
          items={[
            {
              icon: <XCircle className="w-4 h-4 text-orange-600" />,
              label: "Concluir a OS",
              detail: "Garante que fotos e dados foram enviados antes de fechar",
            },
            {
              icon: <XCircle className="w-4 h-4 text-orange-600" />,
              label: "Receber novas OS",
              detail: "Atribuições do admin só aparecem ao sincronizar",
            },
            {
              icon: <XCircle className="w-4 h-4 text-orange-600" />,
              label: "Adicionar legendas nas fotos",
              detail: "Edição de legenda é só online (foto já salva)",
            },
            {
              icon: <XCircle className="w-4 h-4 text-orange-600" />,
              label: "Gerar e enviar PDF",
              detail: "WhatsApp, portal do cliente — requer internet",
            },
          ]}
        />

        {/* Como saber se está sincronizado */}
        <div className="bg-white dark:bg-gray-900 border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-5 h-5 text-blue-600" />
            <p className="font-semibold">Como saber se está sincronizado</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <WifiOff className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Banner amarelo no topo</p>
                <p className="text-xs text-muted-foreground">Aparece quando sem rede — avisa que as alterações serão salvas localmente</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Badge laranja "X pendentes" no header</p>
                <p className="text-xs text-muted-foreground">Mostra quantas alterações ainda não foram enviadas ao servidor</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Wifi className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Toast "Sincronizando..." ao voltar online</p>
                <p className="text-xs text-muted-foreground">Aparece automaticamente — quando virar "Sincronizado!" está tudo enviado</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Download className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Botão "Atualizar OS" no topo do portal</p>
                <p className="text-xs text-muted-foreground">Baixa manualmente as OS mais recentes quando estiver online antes de entrar no subsolo</p>
              </div>
            </div>
          </div>
        </div>

        {/* Dica final */}
        <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4">
          <p className="text-sm font-semibold mb-2">📋 Rotina recomendada em campo</p>
          <ol className="space-y-1.5 text-sm text-muted-foreground">
            <li>1. Antes de entrar no prédio → abrir o portal com internet e clicar em <strong>"Atualizar OS"</strong></li>
            <li>2. Entrar no subsolo → trabalhar normalmente (offline)</li>
            <li>3. Ao sair → esperar o toast <strong>"Sincronizando..."</strong> aparecer e concluir</li>
            <li>4. Só clicar em <strong>Concluir</strong> quando estiver com sinal (garante que fotos foram enviadas)</li>
          </ol>
        </div>

      </main>
    </div>
  );
}
