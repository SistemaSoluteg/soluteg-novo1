import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileUp, Loader2, ChevronDown, ChevronRight, FileText, Download, Eye } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// Nomes dos meses em português (índice 0 não é usado)
const MONTH_NAMES = [
  "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const DOC_TYPE_LABELS: Record<string, string> = {
  vistoria: "Vistoria",
  visita: "Relatório de Visita",
  nota_fiscal: "Nota Fiscal",
  servico: "Relatório de Serviço",
  outro: "Outro",
};

const DOC_TYPE_COLORS: Record<string, string> = {
  vistoria: "bg-blue-100 text-blue-700",
  visita: "bg-purple-100 text-purple-700",
  nota_fiscal: "bg-green-100 text-green-700",
  servico: "bg-yellow-100 text-yellow-700",
  outro: "bg-slate-100 text-slate-700",
};

export default function AdminDocuments() {
  // ID do cliente expandido atualmente (para mostrar seus documentos)
  const [expandedClientId, setExpandedClientId] = useState<number | null>(null);

  // Estado do formulário de upload
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    documentType: "vistoria",
    file: null as File | null,
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
  });

  // Busca a lista de todos os clientes via tRPC
  const { data: clients = [], isLoading: loadingClients } = trpc.clients.list.useQuery(undefined);

  // Busca documentos do cliente expandido — só executa quando há um expandido
  const { data: expandedDocs = [], isFetching: loadingDocs, refetch: refetchDocs } =
    trpc.documents.listAll.useQuery(
      { clientId: expandedClientId ?? undefined },
      { enabled: expandedClientId !== null }
    );

  // Mutation para salvar metadados do documento após o upload do arquivo
  const createDocument = trpc.documents.create.useMutation({
    onSuccess: () => {
      toast.success("Documento enviado com sucesso!");
      refetchDocs();
      setFormData({
        title: "",
        description: "",
        documentType: "vistoria",
        file: null,
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
      });
      setSelectedClientId("");
      setIsOpen(false);
      const fileInput = document.getElementById("file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    },
    onError: (err) => {
      toast.error(`Erro ao salvar documento: ${err.message}`);
    },
  });

  const handleToggleClient = (clientId: number) => {
    setExpandedClientId((prev) => (prev === clientId ? null : clientId));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setFormData((prev) => ({ ...prev, file }));
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedClientId || !formData.file || !formData.title) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    try {
      setUploading(true);

      // Passo 1: envia o arquivo para o Cloudinary via endpoint de upload
      const fd = new FormData();
      fd.append("files", formData.file);
      const res = await fetch("/api/work-orders/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Falha no upload do arquivo");

      const { urls } = await res.json();
      const uploaded = urls[0];

      // Passo 2: salva os metadados via tRPC
      await createDocument.mutateAsync({
        clientId: parseInt(selectedClientId),
        title: formData.title,
        description: formData.description || undefined,
        documentType: formData.documentType as any,
        fileUrl: uploaded.url,
        fileKey: uploaded.key,
        fileSize: uploaded.fileSize,
        mimeType: uploaded.fileType,
        month: formData.month,
        year: formData.year,
      });
    } catch (err: any) {
      toast.error(err.message || "Erro ao fazer upload");
    } finally {
      setUploading(false);
    }
  };

  if (loadingClients) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            <p className="text-slate-600">Carregando clientes...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
            <FileUp className="w-8 h-8 text-orange-500" />
            Enviar Documentos
          </h1>
          <p className="text-slate-600 mt-1">
            Faça upload de relatórios, notas fiscais e outros documentos para seus clientes
          </p>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-orange-500 hover:bg-orange-600">
              <Upload className="w-4 h-4" />
              Enviar Documento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Enviar Documento</DialogTitle>
              <DialogDescription>
                Selecione um cliente e faça upload do documento
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleUpload} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Cliente</label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id.toString()}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Tipo de Documento</label>
                <Select
                  value={formData.documentType}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, documentType: value }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vistoria">Vistoria</SelectItem>
                    <SelectItem value="visita">Relatório de Visita</SelectItem>
                    <SelectItem value="servico">Relatório de Serviço</SelectItem>
                    <SelectItem value="nota_fiscal">Nota Fiscal</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Título do Documento</label>
                <Input
                  placeholder="Ex: Manutenção Bomba - Dezembro 2024"
                  value={formData.title}
                  onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Descrição (opcional)</label>
                <Input
                  placeholder="Detalhes adicionais sobre o documento"
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Mês de Referência</label>
                  <Select
                    value={formData.month.toString()}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, month: parseInt(value) }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.slice(1).map((name, i) => (
                        <SelectItem key={i + 1} value={(i + 1).toString()}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Ano de Referência</label>
                  <Select
                    value={formData.year.toString()}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, year: parseInt(value) }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[2024, 2025, 2026, 2027, 2028].map((y) => (
                        <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Arquivo</label>
                <Input
                  id="file-input"
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.png"
                  onChange={handleFileChange}
                  required
                  disabled={uploading}
                />
                {formData.file && (
                  <p className="text-sm text-slate-500">
                    {formData.file.name} ({(formData.file.size / 1024 / 1024).toFixed(2)} MB)
                  </p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full bg-orange-500 hover:bg-orange-600"
                disabled={uploading}
              >
                {uploading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Enviando...</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" />Enviar Documento</>
                )}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Lista de clientes */}
      <Card>
        <CardHeader>
          <CardTitle>Clientes</CardTitle>
          <CardDescription>
            Clique em um cliente para ver os documentos enviados a ele
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {clients.length === 0 ? (
            <div className="text-center py-12">
              <FileUp className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600">Nenhum cliente cadastrado</p>
              <p className="text-sm text-slate-500">Crie clientes na seção de Gerenciamento de Clientes</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {clients.map((client) => {
                const isExpanded = expandedClientId === client.id;
                // Usa os documentos carregados se este cliente estiver expandido
                const docs = isExpanded ? expandedDocs : [];

                return (
                  <div key={client.id}>
                    {/* Linha do cliente */}
                    <div
                      className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => handleToggleClient(client.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold shrink-0">
                          {client.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900">{client.name}</h3>
                          <p className="text-sm text-slate-500">{client.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-orange-500 hover:text-orange-600 hover:bg-orange-50 gap-1"
                          title="Enviar Documento"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedClientId(client.id.toString());
                            setIsOpen(true);
                          }}
                        >
                          <FileUp className="w-4 h-4" />
                          Enviar
                        </Button>
                        {isExpanded
                          ? <ChevronDown className="w-5 h-5 text-slate-400" />
                          : <ChevronRight className="w-5 h-5 text-slate-400" />
                        }
                      </div>
                    </div>

                    {/* Painel de documentos (só renderiza quando expandido) */}
                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100 px-6 py-4">
                        {loadingDocs ? (
                          <div className="flex items-center gap-2 py-4 text-slate-500">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-sm">Carregando documentos...</span>
                          </div>
                        ) : docs.length === 0 ? (
                          <div className="text-center py-6">
                            <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                            <p className="text-sm text-slate-500">Nenhum documento enviado para este cliente ainda.</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-3 gap-1 border-orange-300 text-orange-600 hover:bg-orange-50"
                              onClick={() => {
                                setSelectedClientId(client.id.toString());
                                setIsOpen(true);
                              }}
                            >
                              <Upload className="w-3 h-3" />
                              Enviar primeiro documento
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                              {docs.length} documento{docs.length !== 1 ? "s" : ""}
                            </p>
                            {docs.map((doc) => (
                              <div
                                key={doc.id}
                                className="flex items-center justify-between bg-white rounded-lg border border-slate-200 px-4 py-3 hover:border-orange-200 transition-colors"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <FileText className="w-5 h-5 text-slate-400 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="font-medium text-slate-800 truncate">{doc.title}</p>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DOC_TYPE_COLORS[doc.documentType] ?? DOC_TYPE_COLORS.outro}`}>
                                        {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}
                                      </span>
                                      {doc.month && doc.year && (
                                        <span className="text-xs text-slate-400">
                                          {MONTH_NAMES[doc.month]}/{doc.year}
                                        </span>
                                      )}
                                      {doc.description && (
                                        <span className="text-xs text-slate-400 truncate max-w-[200px]">
                                          · {doc.description}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 ml-2">
                                  {doc.fileUrl && (
                                    <>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="w-8 h-8 text-slate-400 hover:text-blue-600"
                                        title="Visualizar"
                                        onClick={() => window.open(doc.fileUrl, "_blank")}
                                      >
                                        <Eye className="w-4 h-4" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="w-8 h-8 text-slate-400 hover:text-green-600"
                                        title="Baixar"
                                        onClick={() => {
                                          const a = document.createElement("a");
                                          a.href = doc.fileUrl!;
                                          a.download = doc.title;
                                          a.click();
                                        }}
                                      >
                                        <Download className="w-4 h-4" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
    </DashboardLayout>
  );
}
