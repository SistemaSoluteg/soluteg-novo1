import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, X, File, Image, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type FileCategory = "antes" | "durante" | "depois" | "documento" | "outro";

const categoryMap: Record<FileCategory, "before" | "during" | "after" | "document" | "other"> = {
  antes: "before",
  durante: "during",
  depois: "after",
  documento: "document",
  outro: "other",
};

interface FileUploadProps {
  workOrderId: number;
  onUploadComplete: () => void;
}

export default function FileUpload({ workOrderId, onUploadComplete }: FileUploadProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [category, setCategory] = useState<FileCategory>("durante");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createAttachment = trpc.workOrders.attachments.create.useMutation();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...files]);
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      toast.error("Selecione pelo menos um arquivo");
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append("files", file);
      }

      const response = await fetch("/api/work-orders/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        // Nenhum arquivo do lote foi salvo (falha total) — 'message' vem do backend
        throw new Error(data.message || "Erro ao fazer upload dos arquivos");
      }

      // 'urls' traz só o que realmente subiu pro Cloudinary e é seguro salvar —
      // pode ser menos que selectedFiles.length se algum arquivo falhou no meio
      // do lote (rede instável, timeout etc.) sem derrubar os outros.
      for (const uploaded of data.urls) {
        await createAttachment.mutateAsync({
          workOrderId,
          fileName: uploaded.fileName,
          fileKey: uploaded.key,
          fileUrl: uploaded.url,
          fileType: uploaded.fileType,
          fileSize: uploaded.fileSize,
          category: categoryMap[category],
          uploadedBy: description || undefined,
        });
      }

      if (data.failed?.length) {
        // Falha parcial: avisa quais não subiram, pra tentar de novo só essas
        toast.warning(
          `${data.urls.length} de ${selectedFiles.length} arquivo(s) enviado(s). Falharam: ${data.failed.map((f: any) => f.fileName).join(", ")} — tente reenviar só essas.`
        );
      } else {
        toast.success(`${data.urls.length} arquivo(s) enviado(s) com sucesso!`);
      }
      setSelectedFiles([]);
      setDescription("");
      onUploadComplete();
    } catch (error: any) {
      toast.error(error.message || "Erro ao fazer upload");
    } finally {
      setUploading(false);
    }
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) {
      return <Image className="w-8 h-8 text-blue-500" />;
    } else if (file.type.includes("pdf")) {
      return <FileText className="w-8 h-8 text-red-500" />;
    } else {
      return <File className="w-8 h-8 text-gray-500" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* File Input */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                Selecionar Arquivos
              </Button>
            </div>

            {/* Category Select */}
            <div>
              <Label>Categoria</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as FileCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="antes">Antes do Serviço</SelectItem>
                  <SelectItem value="durante">Durante o Serviço</SelectItem>
                  <SelectItem value="depois">Depois do Serviço</SelectItem>
                  <SelectItem value="documento">Documento</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div>
              <Label>Descrição (opcional)</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descrição do(s) arquivo(s)..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Selected Files */}
      {selectedFiles.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">Arquivos Selecionados ({selectedFiles.length})</h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedFiles([])}
                >
                  Limpar Todos
                </Button>
              </div>

              <div className="space-y-2">
                {selectedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50"
                  >
                    {getFileIcon(file)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(index)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                className="w-full"
                onClick={handleUpload}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Enviar {selectedFiles.length} Arquivo(s)
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
