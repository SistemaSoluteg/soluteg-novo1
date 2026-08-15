import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Input de senha com botão para alternar a visibilidade do texto digitado.
 * Wrapper em cima do <Input> padrão — mesma API, só força o toggle type="password"/"text".
 */
interface PasswordInputProps extends React.ComponentProps<"input"> {
  /** Sobrescreve o estilo do botão de mostrar/ocultar — útil em telas com fundo escuro fixo. */
  toggleClassName?: string;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, toggleClassName, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="relative">
        <Input
          {...props}
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-10", className)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className={cn(
            "absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground",
            toggleClassName
          )}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
