/**
 * useClientManifest — troca o manifest PWA para o do portal do cliente.
 *
 * O index.html tem um único <link rel="manifest"> apontando para o manifest
 * do técnico (gerado pelo vite-plugin-pwa). Quando o cliente acessa o portal,
 * esse hook troca o href para o manifest-client.webmanifest, que tem o nome
 * "Soluteg Cliente", start_url "/client/login" e scope "/client".
 *
 * Ao desmontar (cliente sai do portal), restaura o manifest original.
 * Isso garante que o browser exibe o prompt de instalação correto para cada portal.
 */

import { useEffect } from "react";

export function useClientManifest() {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    // Guarda o manifest original (do técnico) para restaurar depois
    const originalHref = link?.getAttribute("href") ?? "";

    if (link) {
      link.setAttribute("href", "/manifest-client.webmanifest");
    } else {
      // Se não existir o link (improvável), cria um
      const newLink = document.createElement("link");
      newLink.rel = "manifest";
      newLink.href = "/manifest-client.webmanifest";
      document.head.appendChild(newLink);
    }

    return () => {
      // Restaura o manifest do técnico ao sair do portal do cliente
      const l = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
      if (l && originalHref) l.setAttribute("href", originalHref);
    };
  }, []);
}
