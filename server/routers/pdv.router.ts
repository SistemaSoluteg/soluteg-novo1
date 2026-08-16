// ============================================================
// PDV Router — Ponto de Venda JNC Comércio e Serviços
// Auth: pdvProcedure (cookie admin_token)
// DB:   TiDB Cloud (via pdvDb.ts + pdvConnection.ts)
// ============================================================
import { router, pdvProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../pdvDb";
import { generateEAN13, generateBarcodeImage } from "../pdvBarcodeService";
import { storagePut } from "../storage";

export const pdvRouter = router({

  // ── CATEGORIAS ───────────────────────────────────────────
  categories: router({
    list: pdvProcedure.query(async () => {
      return await db.getAllCategories();
    }),

    create: pdvProcedure
      .input(z.object({ name: z.string().min(1).max(100), description: z.string().optional() }))
      .mutation(async ({ input }) => {
        return await db.createCategory(input);
      }),

    update: pdvProcedure
      .input(z.object({ id: z.number(), name: z.string().min(1).max(100).optional(), description: z.string().optional() }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return await db.updateCategory(id, data);
      }),

    delete: pdvProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.deleteCategory(input.id);
      }),
  }),

  // ── PRODUTOS ─────────────────────────────────────────────
  products: router({
    list: pdvProcedure.query(async () => {
      return await db.getAllProducts();
    }),

    getById: pdvProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getProductById(input.id);
      }),

    getByBarcode: pdvProcedure
      .input(z.object({ barcode: z.string().length(13) }))
      .query(async ({ input }) => {
        return await db.getProductByBarcode(input.barcode);
      }),

    search: pdvProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ input }) => {
        return await db.searchProducts(input.query);
      }),

    lowStock: pdvProcedure.query(async () => {
      return await db.getLowStockProducts();
    }),

    create: pdvProcedure
      .input(z.object({
        barcode: z.string().optional(),
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        price: z.string().regex(/^\d+(\.\d{1,2})?$/),
        costPrice: z.string().optional(),
        stock: z.number().int().min(0).default(0),
        minStock: z.number().int().min(0).default(5),
        unit: z.string().max(10).default("un"),
        categoryId: z.number().optional(),
        imageUrl: z.string().url().optional(),
        imageData: z.string().max(5_000_000).optional(), // ~3.75 MB em base64
        imageMimeType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp"]).optional(),
      }))
      .mutation(async ({ input }) => {
        let barcode = input.barcode?.trim();
        if (!barcode) barcode = generateEAN13();

        const MIME_TO_EXT: Record<string, string> = {
          "image/jpeg": "jpg", "image/jpg": "jpg",
          "image/png": "png", "image/webp": "webp",
        };

        let imageUrl = input.imageUrl;
        let imageKey: string | undefined;

        if (input.imageData && input.imageMimeType) {
          const buffer = Buffer.from(input.imageData, "base64");
          const ext = MIME_TO_EXT[input.imageMimeType] ?? "jpg";
          const key = `pdv/products/${barcode}-${Date.now()}.${ext}`;
          const result = await storagePut(key, buffer, input.imageMimeType);
          imageUrl = result.url;
          imageKey = result.key;
        }

        const { imageData, imageMimeType, imageUrl: _iu, ...productData } = input;
        return await db.createProduct({ ...productData, barcode, imageUrl, imageKey });
      }),

    update: pdvProcedure
      .input(z.object({
        id: z.number(),
        barcode: z.string().optional(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
        costPrice: z.string().optional(),
        stock: z.number().int().min(0).optional(),
        minStock: z.number().int().min(0).optional(),
        unit: z.string().max(10).optional(),
        categoryId: z.number().optional(),
        imageUrl: z.string().url().optional(),
        imageData: z.string().max(5_000_000).optional(), // ~3.75 MB em base64
        imageMimeType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const MIME_TO_EXT: Record<string, string> = {
          "image/jpeg": "jpg", "image/jpg": "jpg",
          "image/png": "png", "image/webp": "webp",
        };
        const { id, imageData, imageMimeType, imageUrl: inputImageUrl, ...data } = input;
        let imageUrl: string | undefined = inputImageUrl;
        let imageKey: string | undefined;

        if (imageData && imageMimeType) {
          const buffer = Buffer.from(imageData, "base64");
          const ext = MIME_TO_EXT[imageMimeType] ?? "jpg";
          const key = `pdv/products/${input.barcode || id}-${Date.now()}.${ext}`;
          const result = await storagePut(key, buffer, imageMimeType);
          imageUrl = result.url;
          imageKey = result.key;
        }

        return await db.updateProduct(id, { ...data, ...(imageUrl !== undefined && { imageUrl }), ...(imageKey && { imageKey }) });
      }),

    delete: pdvProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.deleteProduct(input.id);
      }),

    toggleActive: pdvProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const product = await db.getProductById(input.id);
        if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado" });
        return await db.toggleProductActive(input.id, !(product as any).active);
      }),

    importBatch: pdvProcedure
      .input(z.object({
        products: z.array(z.object({
          barcode: z.string().optional(),
          name: z.string().min(1).max(255),
          description: z.string().optional(),
          price: z.string().regex(/^\d+(\.\d{1,2})?$/),
          costPrice: z.string().optional(),
          stock: z.number().int().min(0).default(0),
          minStock: z.number().int().min(0).default(5),
          unit: z.string().max(10).default("un"),
          categoryId: z.number().optional(),
        })).max(500),
      }))
      .mutation(async ({ input }) => {
        let imported = 0;
        const errors: string[] = [];
        for (const product of input.products) {
          try {
            let barcode = product.barcode?.trim();
            if (!barcode || barcode.length !== 13 || !/^\d{13}$/.test(barcode)) {
              barcode = generateEAN13();
            }
            await db.createProduct({ ...product, barcode });
            imported++;
          } catch (error) {
            errors.push(`${product.name}: ${String(error)}`);
          }
        }
        return { imported, errors };
      }),
  }),

  // ── VENDAS ───────────────────────────────────────────────
  sales: router({
    list: pdvProcedure.query(async () => {
      return await db.getAllSales();
    }),

    getById: pdvProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const sale = await db.getSaleById(input.id);
        if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Venda não encontrada" });
        const items = await db.getSaleItemsBySaleId(input.id);
        return { ...sale, items };
      }),

    getWithFilters: pdvProcedure
      .input(z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        paymentMethod: z.enum(["dinheiro", "cartao_debito", "cartao_credito", "pix", "all"]).optional(),
        searchId: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const startDate = input.startDate ? new Date(input.startDate) : undefined;
        if (startDate) startDate.setHours(0, 0, 0, 0);

        const endDate = input.endDate ? new Date(input.endDate) : undefined;
        if (endDate) endDate.setHours(23, 59, 59, 999);

        const searchId = input.searchId ? parseInt(input.searchId) : undefined;

        return await db.getSalesWithFilters({
          startDate,
          endDate,
          paymentMethod: input.paymentMethod,
          searchId: isNaN(searchId as any) ? undefined : searchId,
        });
      }),

    create: pdvProcedure
      .input(z.object({
        items: z.array(z.object({
          productId: z.number(),
          productName: z.string(),
          quantity: z.number().int().min(1),
          unitPrice: z.string(),
        })).max(100),
        discount: z.number().min(0).default(0),
        discountType: z.enum(["percentage", "fixed"]).default("fixed"),
        paymentMethod: z.enum(["dinheiro", "cartao_debito", "cartao_credito", "pix"]).default("dinheiro"),
        amountPaid: z.number().min(0).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        let subtotal = 0;
        for (const item of input.items) {
          subtotal += parseFloat(item.unitPrice) * item.quantity;
        }

        const discountAmount = input.discountType === "percentage"
          ? (subtotal * input.discount) / 100
          : input.discount;

        const total = subtotal - discountAmount;
        const change = input.amountPaid && input.amountPaid > 0 ? input.amountPaid - total : 0;

        const saleResult = await db.createSale({
          total: total.toFixed(2),
          discount: input.discount.toFixed(2),
          discountType: input.discountType,
          paymentMethod: input.paymentMethod,
          amountPaid: input.amountPaid ? input.amountPaid.toFixed(2) : null,
          change: change > 0 ? change.toFixed(2) : null,
          userId: ctx.adminId,
        });

        const saleId = Number(saleResult.insertId);

        for (const item of input.items) {
          const itemSubtotal = parseFloat(item.unitPrice) * item.quantity;
          await db.createSaleItem({
            saleId,
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: itemSubtotal.toFixed(2),
          });

          const product = await db.getProductById(item.productId);
          if (product) {
            await db.updateProduct(item.productId, { stock: product.stock - item.quantity });
          }
        }

        await db.createCashTransaction({
          type: "entrada",
          amount: total.toFixed(2),
          description: `Venda #${saleId}`,
          saleId,
          userId: ctx.adminId,
        });

        return { saleId, total };
      }),

    cancel: pdvProcedure
      .input(z.object({ saleId: z.number(), reason: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const sale = await db.getSaleById(input.saleId);
        if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Venda não encontrada" });
        if ((sale as any).canceled) throw new TRPCError({ code: "BAD_REQUEST", message: "Venda já está cancelada" });

        const items = await db.getSaleItemsBySaleId(input.saleId);
        for (const item of items) {
          const product = await db.getProductById(item.productId);
          if (product) {
            await db.updateProduct(item.productId, { stock: product.stock + item.quantity });
          }
        }

        await db.createCashTransaction({
          type: "saida",
          amount: sale.total,
          description: `Cancelamento da Venda #${input.saleId} - ${input.reason}`,
          saleId: input.saleId,
          userId: ctx.adminId,
        });

        await db.cancelSale(input.saleId, input.reason);
        return { success: true };
      }),
  }),

  // ── FLUXO DE CAIXA ───────────────────────────────────────
  cash: router({
    list: pdvProcedure.query(async () => {
      return await db.getAllCashTransactions();
    }),

    getBalance: pdvProcedure.query(async () => {
      return await db.getCashBalance();
    }),

    createTransaction: pdvProcedure
      .input(z.object({
        type: z.enum(["entrada", "saida"]),
        amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        description: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.createCashTransaction({ ...input, userId: ctx.adminId });
      }),
  }),

  // ── CLIENTES PDV ─────────────────────────────────────────
  customers: router({
    list: pdvProcedure.query(async () => {
      return await db.getAllCustomers();
    }),

    search: pdvProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ input }) => {
        return await db.searchCustomers(input.query);
      }),

    create: pdvProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        cpfCnpj: z.string().max(18).optional(),
        phone: z.string().max(20).optional(),
        email: z.string().email().max(320).optional(),
      }))
      .mutation(async ({ input }) => {
        return await db.createCustomer(input);
      }),

    update: pdvProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        cpfCnpj: z.string().max(18).optional(),
        phone: z.string().max(20).optional(),
        email: z.string().email().max(320).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return await db.updateCustomer(id, data);
      }),

    delete: pdvProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.deleteCustomer(input.id);
      }),
  }),

  // ── DASHBOARD ────────────────────────────────────────────
  dashboard: router({
    stats: pdvProcedure.query(async () => {
      return await db.getDashboardStats();
    }),
  }),

  // ── BACKUP ───────────────────────────────────────────────
  backup: router({
    generate: pdvProcedure.mutation(async () => {
      const backupData = await db.generateFullBackup();
      const jsonContent = JSON.stringify(backupData, null, 2);
      const filename = `backup-pdv-${new Date().toISOString().split("T")[0]}-${Date.now()}.json`;
      return {
        filename,
        data: jsonContent,
        size: Buffer.byteLength(jsonContent, "utf-8"),
        timestamp: backupData.timestamp,
        metadata: backupData.metadata,
      };
    }),
  }),

  // ── MIGRAÇÃO TIDB → MYSQL ────────────────────────────────
  migrate: router({
    /** Verifica se PDV_DATABASE_URL está configurada no servidor */
    checkTidb: pdvProcedure.query(() => {
      return { available: !!process.env.PDV_DATABASE_URL };
    }),

    /** Copia todos os dados do TiDB Cloud para o MySQL principal */
    fromTidb: pdvProcedure.mutation(async () => {
      const tidbUrl = process.env.PDV_DATABASE_URL;
      if (!tidbUrl) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "PDV_DATABASE_URL não está configurada no servidor. Configure o .env e reinicie.",
        });
      }

      const { drizzle } = await import("drizzle-orm/mysql2");
      const { sql } = await import("drizzle-orm");
      const {
        categories, products, sales, saleItems, cashTransactions, customers,
      } = await import("../pdvSchema");

      const tidb = drizzle(tidbUrl);
      const mysql = await import("../db").then(m => m.getDb());
      if (!mysql) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "MySQL não disponível" });

      // Lê tudo do TiDB
      const [
        allCategories, allProducts, allSales,
        allSaleItems, allCash, allCustomers,
      ] = await Promise.all([
        tidb.select().from(categories),
        tidb.select().from(products),
        tidb.select().from(sales),
        tidb.select().from(saleItems),
        tidb.select().from(cashTransactions),
        tidb.select().from(customers),
      ]);

      const results: Record<string, number> = {};

      async function upsertBatch<T extends Record<string, unknown>>(
        table: any,
        rows: T[],
        updateKey: string,
      ) {
        if (rows.length === 0) return 0;
        const BATCH = 200;
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          await mysql!.insert(table).values(chunk as any)
            .onDuplicateKeyUpdate({ set: { [updateKey]: sql.raw(`VALUES(\`${updateKey}\`)`) } });
        }
        return rows.length;
      }

      await mysql.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
      try {
        results.categories       = await upsertBatch(categories,       allCategories, "name");
        results.products         = await upsertBatch(products,         allProducts,   "name");
        results.customers        = await upsertBatch(customers,        allCustomers,  "name");
        results.sales            = await upsertBatch(sales,            allSales,      "total");
        results.saleItems        = await upsertBatch(saleItems,        allSaleItems,  "productName");
        results.cashTransactions = await upsertBatch(cashTransactions, allCash,       "description");
      } finally {
        await mysql.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
      }

      return { success: true, results };
    }),
  }),

  // ── CÓDIGO DE BARRAS ─────────────────────────────────────
  barcode: router({
    generate: pdvProcedure.mutation(() => {
      return { barcode: generateEAN13() };
    }),

    getImage: pdvProcedure
      .input(z.object({ barcode: z.string().min(1).max(30) }))
      .query(async ({ input }) => {
        const imageBuffer = await generateBarcodeImage(input.barcode);
        return { imageBase64: imageBuffer.toString("base64") };
      }),
  }),
});

export type PdvRouter = typeof pdvRouter;
