import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
// Módulo virtual gerado pelo vite-plugin-pwa — só existe após o build
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

// Registra o service worker assim que o app carrega.
// updateSW() pode ser chamado futuramente para forçar atualização manual.
// onRegistered: log de confirmação no console para debug em campo
// onRegisterError: falha silenciosa — app funciona normalmente sem SW
registerSW({
  onRegistered(r: ServiceWorkerRegistration | undefined) {
    console.log("[OFFLINE] Service worker registrado:", r);
  },
  onRegisterError(error: unknown) {
    console.warn("[OFFLINE] Falha ao registrar service worker:", error);
  },
});

const queryClient = new QueryClient();

// Redireciona para a tela de login correta conforme o portal atual.
// Sem isso, qualquer 401 manda o técnico para /gestor/login (fora do
// escopo /technician do PWA), abrindo um aba do browser e quebrando o fluxo.
const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;

  const path = window.location.pathname;
  if (path.startsWith("/technician")) {
    window.location.href = "/technician/login";
  } else if (path.startsWith("/client")) {
    window.location.href = "/client/login";
  } else if (path.startsWith("/pdv")) {
    window.location.href = "/gestor/login?redirect=/pdv";
  } else {
    window.location.href = getLoginUrl();
  }
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      // VITE_API_URL quando definido no .env aponta para o backend (ex: http://localhost:5000).
      // Sem a variável, usa a mesma origem do app — garante que o cookie de autenticação
      // seja enviado corretamente (cookie de app.soluteg.com.br não vai para jnc.soluteg.com.br).
      url: `${import.meta.env.VITE_API_URL || window.location.origin}/api/trpc`,
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include", 
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
