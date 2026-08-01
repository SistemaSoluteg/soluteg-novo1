import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Trash2, Lock, Unlock, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface WorkOrderCommentsProps {
  workOrderId: number;
}

export default function WorkOrderComments({ workOrderId }: WorkOrderCommentsProps) {
  const [newComment, setNewComment] = useState("");
  const [isInternal, setIsInternal] = useState(true);
  const [showInternal, setShowInternal] = useState(true);

  const { data: comments, refetch } = trpc.workOrders.comments.list.useQuery({
    workOrderId,
    includeInternal: showInternal,
  });

  const createCommentMutation = trpc.workOrders.comments.create.useMutation({
    onSuccess: () => {
      toast.success("Comentário adicionado com sucesso");
      refetch();
      setNewComment("");
    },
    onError: (error) => {
      toast.error(`Erro ao adicionar comentário: ${error.message}`);
    },
  });

  const deleteCommentMutation = trpc.workOrders.comments.delete.useMutation({
    onSuccess: () => {
      toast.success("Comentário removido com sucesso");
      refetch();
    },
    onError: (error) => {
      toast.error(`Erro ao remover comentário: ${error.message}`);
    },
  });

  const aiSuggestMutation = trpc.workOrders.comments.suggestForClient.useMutation({
    onSuccess: (data) => {
      setNewComment(data.comentario);
      toast.success("Sugestão aplicada — revise antes de enviar");
    },
    onError: (error) => {
      toast.error(`Erro na sugestão de IA: ${error.message}`);
    },
  });

  const handleCreateComment = () => {
    if (!newComment.trim()) {
      toast.error("Comentário não pode estar vazio");
      return;
    }

    createCommentMutation.mutate({
      workOrderId,
      userId: "Admin",
      userType: "admin",
      comment: newComment,
      isInternal: isInternal ? 1 : 0,
    });
  };

  const handleDeleteComment = (commentId: number) => {
    if (confirm("Tem certeza que deseja remover este comentário?")) {
      deleteCommentMutation.mutate({ id: commentId });
    }
  };

  const getUserInitials = (userId: string) => {
    return userId.substring(0, 2).toUpperCase();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Comentários e Anotações</CardTitle>
          <div className="flex items-center gap-2">
            <Switch
              id="show-internal"
              checked={showInternal}
              onCheckedChange={setShowInternal}
            />
            <Label htmlFor="show-internal" className="text-sm">
              Mostrar internos
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* New Comment Form */}
        <div className="space-y-3">
          <div className="relative">
            <Textarea
              placeholder="Adicione um comentário ou anotação..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={3}
              className="resize-none pr-10"
            />
            {/* Botão IA — só visível quando o comentário será público (visível ao cliente) */}
            {!isInternal && (
              <button
                type="button"
                title="Sugerir comentário para o cliente com IA"
                disabled={aiSuggestMutation.isPending}
                onClick={() => aiSuggestMutation.mutate({ workOrderId })}
                className="absolute top-2 right-2 text-muted-foreground hover:text-purple-600 transition-colors p-1 rounded disabled:opacity-50"
              >
                {aiSuggestMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Sparkles className="h-4 w-4" />}
              </button>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch
                id="is-internal"
                checked={isInternal}
                onCheckedChange={setIsInternal}
              />
              <Label htmlFor="is-internal" className="text-sm flex items-center gap-1">
                {isInternal ? (
                  <>
                    <Lock className="h-3 w-3" />
                    Comentário interno
                  </>
                ) : (
                  <>
                    <Unlock className="h-3 w-3" />
                    Visível para o cliente
                  </>
                )}
              </Label>
            </div>
            <Button
              onClick={handleCreateComment}
              disabled={createCommentMutation.isPending || !newComment.trim()}
            >
              {createCommentMutation.isPending ? "Enviando..." : "Adicionar Comentário"}
            </Button>
          </div>
        </div>

        {/* Comments List */}
        <div className="space-y-4">
          {comments && comments.length > 0 ? (
            comments.map((comment) => (
              <div
                key={comment.id}
                className={`flex gap-3 p-4 rounded-lg border ${
                  comment.isInternal === 1
                    ? "bg-yellow-50 border-yellow-200"
                    : "bg-blue-50 border-blue-200"
                }`}
              >
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {getUserInitials(comment.userId)}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{comment.userId}</span>
                      <Badge
                        variant={comment.userType === "admin" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {comment.userType === "admin" ? "Admin" : "Cliente"}
                      </Badge>
                      {comment.isInternal === 1 && (
                        <Badge variant="outline" className="text-xs">
                          <Lock className="h-3 w-3 mr-1" />
                          Interno
                        </Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleDeleteComment(comment.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <p className="text-sm whitespace-pre-wrap">{comment.comment}</p>

                  <p className="text-xs text-gray-600">
                    {new Date(comment.createdAt).toLocaleString("pt-BR")}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-gray-500">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>Nenhum comentário ainda</p>
              <p className="text-sm mt-1">
                Adicione anotações internas ou comentários para o cliente
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
