# Guia de Deployment — Soluteg

Como subir mudanças de código e aplicar migrações de banco, em **staging** e **produção**.

> **Regra de ouro:** o **código** e o **banco** são deploys separados.
> `deploy-app`/`deploy-tst` sobem só o **código**. Migrações de schema são aplicadas **à mão no DBeaver**, com **backup antes**. Nunca confie no deploy para migrar o banco.

---

## 1. Ambientes

| Item | **Produção** | **Staging** |
|------|--------------|-------------|
| Domínio | `app.soluteg.com.br` | `tst.soluteg.com.br` |
| Branch | `master` | `multi-tenant` |
| Comando de deploy | `deploy-app` | `deploy-tst` |
| Processo PM2 | `soluteg-sistema` (porta 3000) | `soluteg-staging` (porta 3001) |
| Pasta no VPS | `/var/www/soluteg/backend` | `/var/www/soluteg-staging` |
| Banco MySQL | `d5ea2e96_solutegdb` | `d5ea2e96_tst` |
| Usuário MySQL | `d5ea2e96_soluteg` | `d5ea2e96_id_rsa` |
| Backups | `/var/backups/soluteg-producao/` | `/var/backups/soluteg-staging/` |

**Infra comum:**
- **VPS (app):** `129.121.36.243`, SSH porta `22022`, usuário `root`.
- **MySQL:** host `69.6.213.57:3306` (servidor separado do VPS de app).
- **Repositório:** `JncBombas/soluteg-novo1` (cuidado com o typo comum `solueg-novo1`, sem o "t").

> O staging é isolado por flags no `.env`: `PORT=3001`, `DB_NAME=d5ea2e96_tst`, `MQTT_DISABLED=true`, `WHATSAPP_DISABLED=true`. Assim ele não consome MQTT real nem envia WhatsApp para clientes.

---

## 2. Deploy de código

O deploy só puxa o código do GitHub e reinicia a aplicação — por isso **todo commit precisa ter sido `git push`ado antes** (o deploy faz `git pull`).

### Forma normal (atalhos)

```bash
# produção (após git push na master)
deploy-app

# staging (após git push na multi-tenant)
deploy-tst
```

Esses atalhos executam, na pasta do ambiente, a sequência abaixo. Se algum dia precisar rodar na mão (ou o atalho falhar), é exatamente isto:

```bash
cd /var/www/soluteg-staging        # ou /var/www/soluteg/backend em produção
git pull origin multi-tenant       # ou master em produção
pnpm install
pnpm run build
pm2 restart soluteg-staging --update-env   # ou soluteg-sistema em produção
```

> `--update-env` é importante: recarrega o `.env` (necessário, por exemplo, quando o `JWT_SECRET` é rotacionado).

### Acesso ao VPS

```bash
ssh -o HostKeyAlgorithms=ssh-rsa root@129.121.36.243 -p 22022
```

---

## 3. Migrações de banco (NÃO fazem parte do deploy)

As migrações de schema são aplicadas **manualmente no DBeaver**, no banco do ambiente. O deploy de código não toca no banco.

**Passo a passo seguro:**

1. **Backup obrigatório antes** (regra de proteção de dados):
   ```bash
   mysqldump -h 69.6.213.57 -u <usuario> -p \
     --routines --triggers --single-transaction --no-tablespaces \
     <banco> > /var/backups/<dir>/backup-pre-<descricao>-$(date +%Y%m%d-%H%M%S).sql
   chmod 600 /var/backups/<dir>/backup-pre-*.sql
   ```
2. **Aplicar em staging primeiro** (`d5ea2e96_tst`), nunca direto em produção.
3. **Rodar o script SQL no DBeaver.** Se o arquivo foi gerado pelo Drizzle Kit e contém marcadores `--> statement-breakpoint`, **remova-os antes** — não são SQL válido. Prefira aplicar/validar **statement por statement**, porque FKs e índices que vêm depois de um `CREATE TABLE` podem passar despercebidos.
4. **Validar depois** via `information_schema` (a coluna virou o tipo certo? a FK e o índice existem?) e por contagem (`SELECT COUNT(*)` antes/depois batem?).
5. **Registrar** o que precisa replicar em produção em [`../PENDENCIAS_DEPLOY_PRODUCAO.md`](../PENDENCIAS_DEPLOY_PRODUCAO.md).

> Detalhes e armadilhas das migrações (duas pastas `drizzle/`, `__drizzle_migrations` vazia, `sed` vs `grep -v`) estão em [`../CLAUDE.md`](../CLAUDE.md) §5.5 e [`DATA_PROTECTION.md`](./DATA_PROTECTION.md).

---

## 4. Rollback

Não há rollback automatizado. Em caso de problema após um deploy de código:

```bash
cd /var/www/soluteg/backend     # ou soluteg-staging
git checkout <commit-anterior>
pnpm install
pnpm run build
pm2 restart soluteg-sistema --update-env
```

Se o problema for de banco, restaurar do backup feito antes da migração (`mysql < backup-pre-*.sql`).

---

## 5. Verificação e troubleshooting

```bash
pm2 status soluteg-sistema     # estado do processo (online/errored)
pm2 logs soluteg-sistema       # logs em tempo real
```

- **App não responde:** `pm2 logs` para ver o erro; `pm2 restart <proc> --update-env`; conferir a porta (`netstat -tlnp | grep 3000`).
- **Erro de conexão com o banco:** conferir as variáveis do `.env` (`DB_HOST`/`DB_NAME`/`DB_USER`) e se o MySQL em `69.6.213.57` está acessível.
- **Erro no build:** `rm -rf node_modules && pnpm install` e refazer `pnpm run build`.

---

## 6. Referências

| Assunto | Onde |
|---------|------|
| Contexto operacional e regras de banco | [`../CLAUDE.md`](../CLAUDE.md) |
| Proteção de dados (backup, soft delete, tabelas intocáveis) | [`DATA_PROTECTION.md`](./DATA_PROTECTION.md) |
| O que falta replicar em produção | [`../PENDENCIAS_DEPLOY_PRODUCAO.md`](../PENDENCIAS_DEPLOY_PRODUCAO.md) |
| Visão de infraestrutura completa | [`../ARCHITECTURE_HANDOFF.md`](../ARCHITECTURE_HANDOFF.md) §3 |

> **Nota:** confirmar com o Thiago se os atalhos `deploy-app`/`deploy-tst` fazem exatamente a sequência da seção 2 (pull → install → build → restart). Se fizerem algo a mais/menos, atualizar esta seção.
