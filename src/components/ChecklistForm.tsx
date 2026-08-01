import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Camera, Check, X, Minus, Save, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConditionalRule {
  field: string;
  operator: "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "==" | "!=" | ">=" | "<=" | ">" | "<";
  value: string | number;
}

interface FormField {
  id: string;
  label: string;
  type: "ok_nok_na" | "text" | "number" | "select" | "textarea" | "checkbox_table";
  options?: string[];
  items?: string[];
  unit?: string;
  required?: boolean;
  conditional?: ConditionalRule;
}

interface FormItem {
  id: string;
  label: string;
  type: "ok_nok_na";
  required?: boolean;
}

interface FormSection {
  id: string;
  title: string;
  items?: FormItem[];
  fields?: FormField[];
}

interface FormStructure {
  sections: FormSection[];
}

interface ChecklistFormProps {
  formStructure: FormStructure;
  initialResponses?: Record<string, unknown>;
  onSave: (responses: Record<string, unknown>, isComplete: boolean) => void;
  isSaving?: boolean;
  readOnly?: boolean;
  /**
   * Chamado quando o usuário captura uma foto em um item do checklist.
   * O pai faz o upload e cria o anexo na OS — o ChecklistForm só coleta
   * o arquivo e a legenda.
   * caption = texto da legenda (pode ser editado pelo usuário)
   * file    = arquivo de imagem selecionado
   */
  onAddPhoto?: (caption: string, file: File) => Promise<void>;
}

// ✅ FIX: Clicar no botão já selecionado agora DESSEleciona (toggle)
// Isso evita o bug de "marcar duas respostas" por toque duplo no celular
function OkNokNaButtons({
  value,
  onChange,
  disabled,
}: {
  value?: string;
  onChange: (val: string | null) => void;
  disabled?: boolean;
}) {
  const handleClick = (val: string) => {
    // Toggle: clicou no mesmo valor → desseleciona
    onChange(value === val ? null : val);
  };

  return (
    // ✅ gap maior e botões maiores para facilitar toque no celular
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => handleClick("ok")}
        disabled={disabled}
        className={cn(
          "flex items-center justify-center h-10 w-14 rounded-md border text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          disabled && "opacity-50 cursor-not-allowed",
          value === "ok"
            ? "bg-green-600 border-green-600 text-white"
            : "border-input bg-background text-foreground hover:bg-muted"
        )}
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => handleClick("nok")}
        disabled={disabled}
        className={cn(
          "flex items-center justify-center h-10 w-14 rounded-md border text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          disabled && "opacity-50 cursor-not-allowed",
          value === "nok"
            ? "bg-red-600 border-red-600 text-white"
            : "border-input bg-background text-foreground hover:bg-muted"
        )}
      >
        <X className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => handleClick("na")}
        disabled={disabled}
        className={cn(
          "flex items-center justify-center h-10 w-14 rounded-md border text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          disabled && "opacity-50 cursor-not-allowed",
          value === "na"
            ? "bg-gray-500 border-gray-500 text-white"
            : "border-input bg-background text-foreground hover:bg-muted"
        )}
      >
        <Minus className="h-4 w-4" />
      </button>
    </div>
  );
}

function evaluateConditional(
  conditional: ConditionalRule,
  responses: Record<string, unknown>
): boolean {
  const { field: condField, operator, value } = conditional;
  const currentValue = responses[condField];

  if (currentValue === undefined || currentValue === null || currentValue === "") return false;

  const numCurrent = Number(currentValue);
  const numValue = Number(value);

  switch (operator) {
    case "eq":
    case "==":
      return String(currentValue) === String(value) || numCurrent === numValue;
    case "neq":
    case "!=":
      return String(currentValue) !== String(value) && numCurrent !== numValue;
    case "gte":
    case ">=":
      return !isNaN(numCurrent) && !isNaN(numValue) && numCurrent >= numValue;
    case "lte":
    case "<=":
      return !isNaN(numCurrent) && !isNaN(numValue) && numCurrent <= numValue;
    case "gt":
    case ">":
      return !isNaN(numCurrent) && !isNaN(numValue) && numCurrent > numValue;
    case "lt":
    case "<":
      return !isNaN(numCurrent) && !isNaN(numValue) && numCurrent < numValue;
    default:
      return true;
  }
}

function checkCompletion(
  formStructure: FormStructure,
  responses: Record<string, unknown>
): boolean {
  for (const section of formStructure.sections) {
    if (section.items) {
      for (const item of section.items) {
        if (item.required !== false) {
          const value = responses[item.id];
          if (!value || !["ok", "nok", "na"].includes(value as string)) return false;
        }
      }
    }
    if (section.fields) {
      for (const field of section.fields) {
        if (field.conditional && !evaluateConditional(field.conditional, responses)) continue;
        if (field.required) {
          const value = responses[field.id];
          if (value === undefined || value === null || value === "") return false;
        }
      }
    }
  }
  return true;
}

export default function ChecklistForm({
  formStructure,
  initialResponses = {},
  onSave,
  isSaving = false,
  readOnly = false,
  onAddPhoto,
}: ChecklistFormProps) {
  const [responses, setResponses] = useState<Record<string, unknown>>(initialResponses);

  // ── Estado do dialog de foto por item ──────────────────────────────────────
  // Armazena qual item está com a câmera aberta, o arquivo selecionado e a legenda.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [pendingPhotoItem, setPendingPhotoItem] = useState<{ id: string; label: string } | null>(null);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [pendingPhotoPreview, setPendingPhotoPreview] = useState<string | null>(null);
  const [pendingPhotoCaption, setPendingPhotoCaption] = useState("");
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  function handleCameraClick(itemId: string, itemLabel: string) {
    setPendingPhotoItem({ id: itemId, label: itemLabel });
    photoInputRef.current?.click();
  }

  function handlePhotoFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingPhotoFile(file);
    setPendingPhotoCaption(pendingPhotoItem?.label ?? "");
    setPendingPhotoPreview(URL.createObjectURL(file));
    setPhotoDialogOpen(true);
    // Limpa o input para permitir selecionar o mesmo arquivo novamente se precisar
    e.target.value = "";
  }

  function resetPhotoDialog() {
    setPhotoDialogOpen(false);
    setPendingPhotoFile(null);
    setPendingPhotoItem(null);
    if (pendingPhotoPreview) URL.revokeObjectURL(pendingPhotoPreview);
    setPendingPhotoPreview(null);
    setPendingPhotoCaption("");
  }

  async function handleSavePhoto() {
    if (!pendingPhotoFile || !onAddPhoto) return;
    setIsUploadingPhoto(true);
    try {
      await onAddPhoto(pendingPhotoCaption, pendingPhotoFile);
      resetPhotoDialog();
    } catch {
      // Erro tratado pelo pai via toast
    } finally {
      setIsUploadingPhoto(false);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  let parsedFormStructure: FormStructure | null = formStructure as any;
  if (typeof formStructure === "string") {
    try {
      parsedFormStructure = JSON.parse(formStructure);
    } catch (e) {
      parsedFormStructure = null;
    }
  }

  // ✅ FIX: só reseta o formulário quando o CONTEÚDO das respostas muda de verdade (ex: após salvar e refetch).
  // Antes, qualquer re-render do componente pai criava um novo objeto `{}`, o que disparava o
  // useEffect e apagava tudo que o técnico havia digitado mas ainda não tinha salvo.
  const prevResponsesJsonRef = useRef<string>(JSON.stringify(initialResponses));
  useEffect(() => {
    const nextJson = JSON.stringify(initialResponses);
    if (nextJson !== prevResponsesJsonRef.current) {
      prevResponsesJsonRef.current = nextJson;
      setResponses(initialResponses);
    }
  }, [initialResponses]);

  const isComplete = useMemo(
    () => parsedFormStructure ? checkCompletion(parsedFormStructure, responses) : false,
    [parsedFormStructure, responses]
  );

  const handleChange = (fieldId: string, value: unknown) => {
    // ✅ null significa "desselecionar" — remove a chave do mapa
    setResponses((prev) => {
      if (value === null) {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      }
      return { ...prev, [fieldId]: value };
    });
  };

  const handleSave = () => {
    onSave(responses, isComplete);
  };

  const renderField = (field: FormField) => {
    if (field.conditional && !evaluateConditional(field.conditional, responses)) return null;

    const value = responses[field.id];

    switch (field.type) {
      case "ok_nok_na":
        return (
          <div
            key={field.id}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-2 border-b border-border/50 last:border-0 gap-2"
          >
            <Label className="text-sm">{field.label}</Label>
            <OkNokNaButtons
              value={value as string}
              onChange={(val) => handleChange(field.id, val)}
              disabled={readOnly}
            />
          </div>
        );

      case "text":
        return (
          <div key={field.id} className="space-y-1.5">
            <Label className="text-sm">
              {field.label}
              {field.unit && <span className="text-muted-foreground ml-1">({field.unit})</span>}
            </Label>
            <Input
              value={(value as string) || ""}
              onChange={(e) => handleChange(field.id, e.target.value)}
              disabled={readOnly}
              placeholder={`Digite ${field.label.toLowerCase()}`}
            />
          </div>
        );

      case "number":
        return (
          <div key={field.id} className="space-y-1.5">
            <Label className="text-sm">
              {field.label}
              {field.unit && <span className="text-muted-foreground ml-1">({field.unit})</span>}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={(value as string) || ""}
                onChange={(e) => handleChange(field.id, e.target.value)}
                disabled={readOnly}
                placeholder="0"
                className="flex-1"
              />
              {field.unit && (
                <span className="text-sm text-muted-foreground w-8">{field.unit}</span>
              )}
            </div>
          </div>
        );

      case "select":
        return (
          <div key={field.id} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm">{field.label}</Label>
              {!readOnly && onAddPhoto && field.id.startsWith("tipo_bomba_") && (
                <button
                  type="button"
                  onClick={() => handleCameraClick(field.id, field.label)}
                  title={`Adicionar foto — ${field.label}`}
                  className="text-muted-foreground hover:text-blue-600 transition-colors p-1 rounded"
                >
                  <Camera className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select
              value={(value as string) || ""}
              onValueChange={(val) => handleChange(field.id, val)}
              disabled={readOnly}
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder={`Selecione ${field.label.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );

      case "textarea":
        return (
          <div key={field.id} className="space-y-1.5">
            <Label className="text-sm">{field.label}</Label>
            <Textarea
              value={(value as string) || ""}
              onChange={(e) => handleChange(field.id, e.target.value)}
              disabled={readOnly}
              placeholder={`Digite ${field.label.toLowerCase()}`}
              rows={3}
            />
          </div>
        );

      case "checkbox_table":
        return (
          <div key={field.id} className="space-y-2">
            <Label className="text-sm font-medium">{field.label}</Label>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    {field.options?.map((option) => (
                      <th key={option} className="px-3 py-2 text-center font-medium">
                        {option}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {field.items?.map((item) => (
                    <tr key={item} className="border-b last:border-0">
                      <td className="px-3 py-2">{item}</td>
                      {field.options?.map((option) => {
                        const itemKey = `${field.id}_${item}_${option}`;
                        return (
                          <td key={option} className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={responses[itemKey] === true}
                              onChange={(e) => handleChange(itemKey, e.target.checked)}
                              disabled={readOnly}
                              className="h-5 w-5 cursor-pointer"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (!parsedFormStructure?.sections || !Array.isArray(parsedFormStructure.sections)) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        Nenhuma estrutura de formulário disponível
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {parsedFormStructure.sections.map((section) => (
        <Card key={section.id}>
          <CardHeader className="py-3 px-4 bg-muted/30">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">{section.title}</CardTitle>
              {!readOnly && onAddPhoto && (
                <button
                  type="button"
                  onClick={() => handleCameraClick(section.id, section.title)}
                  title={`Adicionar foto — ${section.title}`}
                  className="text-muted-foreground hover:text-blue-600 transition-colors p-1 rounded"
                >
                  <Camera className="h-4 w-4" />
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {/* ✅ Items Ok/NOk/NA — renderizados UMA VEZ apenas aqui */}
            {section.items?.map((item) => {
              // Chaves no formato visual_items_* (compatível com o PDF e com instâncias antigas)
              const okKey  = `visual_items_${item.label}_OK`;
              const nokKey = `visual_items_${item.label}_NOK`;
              const naKey  = `visual_items_${item.label}_N/A`;

              // Leitura: prioriza item.id (formato novo) e recai em visual_items_* (instâncias antigas)
              const currentValue =
                (responses[item.id] as string) ||
                (responses[okKey]  ? 'ok'  :
                 responses[nokKey] ? 'nok' :
                 responses[naKey]  ? 'na'  : undefined);

              // Escrita: salva AMBOS os formatos para garantir compatibilidade com o PDF
              const handleItemChange = (val: string | null) => {
                setResponses(prev => {
                  const next = { ...prev };
                  if (val === null) {
                    delete next[item.id];
                  } else {
                    next[item.id] = val;          // formato novo (para checkCompletion)
                  }
                  next[okKey]  = val === 'ok';   // formato PDF (visual_items_*)
                  next[nokKey] = val === 'nok';
                  next[naKey]  = val === 'na';
                  return next;
                });
              };

              return (
              <div
                key={item.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-2 border-b border-border/50 last:border-0 gap-2"
              >
                <Label className="text-sm">{item.label}</Label>
                <div className="flex items-center gap-2 shrink-0">
                  <OkNokNaButtons
                    value={currentValue}
                    onChange={handleItemChange}
                    disabled={readOnly}
                  />
                  {/* Botão de câmera — só aparece quando o pai fornece onAddPhoto e o form não está em readOnly */}
                  {!readOnly && onAddPhoto && (
                    <button
                      type="button"
                      onClick={() => handleCameraClick(item.id, item.label)}
                      title={`Adicionar foto — ${item.label}`}
                      className="shrink-0 text-muted-foreground hover:text-blue-600 transition-colors p-1 rounded"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              );
            })}

            {/* Fields com avaliação de conditional centralizada */}
            {section.fields?.map((field) => renderField(field))}
          </CardContent>
        </Card>
      ))}

      {!readOnly && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            {isComplete ? (
              <span className="text-green-600 font-medium">✓ Todos os campos obrigatórios preenchidos</span>
            ) : (
              "Preencha todos os campos obrigatórios"
            )}
          </p>
          <Button onClick={handleSave} disabled={isSaving} className="h-11 px-6 w-full sm:w-auto">
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Salvar
              </>
            )}
          </Button>
        </div>
      )}

      {/* Input de arquivo oculto — acionado pelo botão de câmera de cada item */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePhotoFileSelected}
      />

      {/* Dialog: preview + legenda da foto capturada */}
      <Dialog open={photoDialogOpen} onOpenChange={(open) => { if (!open) resetPhotoDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Foto do Item</DialogTitle>
          </DialogHeader>

          {pendingPhotoPreview && (
            <img
              src={pendingPhotoPreview}
              alt="Preview"
              className="w-full max-h-52 object-cover rounded-lg border"
            />
          )}

          <div className="space-y-1.5">
            <Label>Legenda (opcional)</Label>
            <Input
              value={pendingPhotoCaption}
              onChange={(e) => setPendingPhotoCaption(e.target.value)}
              placeholder={`Ex: ${pendingPhotoItem?.label ?? "descrição"} com problema`}
              onKeyDown={(e) => { if (e.key === "Enter") handleSavePhoto(); }}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              A foto será salva na aba <strong>Anexos</strong> da OS.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetPhotoDialog} disabled={isUploadingPhoto}>
              Cancelar
            </Button>
            <Button
              onClick={handleSavePhoto}
              disabled={!pendingPhotoFile || isUploadingPhoto}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isUploadingPhoto ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</>
              ) : (
                <><Camera className="h-4 w-4 mr-2" />Salvar nos Anexos</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
