// ============================================================
// PDV Database Helpers — usa conexão TiDB Cloud separada
// Tabelas: categories, products, sales, saleItems,
//          cashTransactions, customers
// ============================================================
import { eq, desc, and, gte, lte, lt, sql, asc } from "drizzle-orm";
import { getDb } from "./db";

async function getPdvDb() {
  const db = await getDb();
  if (!db) throw new Error("[PDV] Database not available");
  return db;
}
import {
  categories,
  products,
  sales,
  saleItems,
  cashTransactions,
  customers,
} from "./pdvSchema";

// ============ CATEGORIES ============

export async function createCategory(category: { name: string; description?: string }) {
  const db = await getPdvDb();
  return await db.insert(categories).values(category);
}

export async function getAllCategories() {
  const db = await getPdvDb();
  return await db.select().from(categories).orderBy(asc(categories.name));
}

export async function updateCategory(id: number, data: { name?: string; description?: string }) {
  const db = await getPdvDb();
  return await db.update(categories).set(data).where(eq(categories.id, id));
}

export async function deleteCategory(id: number) {
  const db = await getPdvDb();
  return await db.delete(categories).where(eq(categories.id, id));
}

// ============ PRODUCTS ============

export async function createProduct(product: {
  barcode: string;
  name: string;
  description?: string;
  price: string;
  costPrice?: string;
  stock: number;
  minStock?: number;
  unit?: string;
  categoryId?: number;
  imageUrl?: string;
  imageKey?: string;
}) {
  const db = await getPdvDb();
  return await db.insert(products).values({ minStock: 5, active: true, ...product } as any);
}

export async function getAllProducts() {
  const db = await getPdvDb();
  return await db.select().from(products).orderBy(desc(products.createdAt));
}

export async function getProductById(id: number) {
  const db = await getPdvDb();
  const result = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return result[0];
}

export async function getProductByBarcode(barcode: string) {
  const db = await getPdvDb();
  const result = await db.select().from(products).where(eq(products.barcode, barcode)).limit(1);
  return result[0];
}

export async function updateProduct(id: number, data: Partial<{
  barcode: string; name: string; description: string; price: string; costPrice: string;
  stock: number; minStock: number; unit: string; categoryId: number;
  imageUrl: string; imageKey: string; active: boolean;
}>) {
  const db = await getPdvDb();
  return await db.update(products).set(data as any).where(eq(products.id, id));
}

export async function deleteProduct(id: number) {
  const db = await getPdvDb();
  return await db.delete(products).where(eq(products.id, id));
}

export async function getLowStockProducts() {
  const db = await getPdvDb();
  return await db.select().from(products).where(
    sql`${products.stock} <= ${products.minStock} AND ${products.active} = 1`
  );
}

export async function searchProducts(query: string) {
  const db = await getPdvDb();
  return await db.select().from(products).where(
    sql`(${products.name} LIKE ${`%${query}%`} OR ${products.barcode} LIKE ${`%${query}%`}) AND ${products.active} = 1`
  );
}

export async function toggleProductActive(productId: number, active: boolean) {
  const db = await getPdvDb();
  return await db.update(products).set({ active } as any).where(eq(products.id, productId));
}

export async function getActiveProducts() {
  const db = await getPdvDb();
  return await db.select().from(products)
    .where(eq(products.active as any, true))
    .orderBy(asc(products.name));
}

// ============ SALES ============

export async function createSale(sale: {
  total: string;
  discount?: string;
  discountType?: "percentage" | "fixed";
  paymentMethod: "dinheiro" | "cartao_debito" | "cartao_credito" | "pix";
  amountPaid?: string | null;
  change?: string | null;
  customerId?: number;
  userId: number;
}) {
  const db = await getPdvDb();
  const values: any = {
    total: sale.total,
    paymentMethod: sale.paymentMethod,
    userId: sale.userId,
  };
  if (sale.discount != null)     values.discount     = sale.discount;
  if (sale.discountType != null) values.discountType = sale.discountType;
  if (sale.amountPaid != null)   values.amountPaid   = sale.amountPaid;
  if (sale.change != null)       values.change       = sale.change;
  if (sale.customerId != null)   values.customerId   = sale.customerId;
  const result = await db.insert(sales).values(values);
  return { insertId: (result as any)[0]?.insertId || (result as any).insertId };
}

export async function getSaleById(id: number) {
  const db = await getPdvDb();
  const result = await db.select().from(sales).where(eq(sales.id, id)).limit(1);
  return result[0];
}

export async function getAllSales() {
  const db = await getPdvDb();
  return await db.select().from(sales).orderBy(desc(sales.createdAt));
}

export async function getSalesWithFilters(filters: {
  startDate?: Date;
  endDate?: Date;
  paymentMethod?: string;
  searchId?: number;
}) {
  const db = await getPdvDb();
  const conditions = [];

  if (filters.startDate) conditions.push(gte(sales.createdAt, filters.startDate));
  if (filters.endDate) conditions.push(lte(sales.createdAt, filters.endDate));
  if (filters.paymentMethod && filters.paymentMethod !== "all") {
    conditions.push(eq(sales.paymentMethod, filters.paymentMethod as any));
  }
  if (filters.searchId) conditions.push(eq(sales.id, filters.searchId));

  return await db.select().from(sales)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sales.createdAt));
}

export async function getSalesByDateRange(startDate: Date, endDate: Date) {
  const db = await getPdvDb();
  return await db.select().from(sales).where(
    and(gte(sales.createdAt, startDate), lte(sales.createdAt, endDate))
  ).orderBy(desc(sales.createdAt));
}

export async function cancelSale(saleId: number, reason: string) {
  const db = await getPdvDb();
  await db.update(sales).set({
    canceled: true,
    cancelReason: reason,
    canceledAt: new Date(),
  } as any).where(eq(sales.id, saleId));
  return { success: true };
}

// ============ SALE ITEMS ============

export async function createSaleItem(item: {
  saleId: number;
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
}) {
  const db = await getPdvDb();
  return await db.insert(saleItems).values(item);
}

export async function getSaleItemsBySaleId(saleId: number) {
  const db = await getPdvDb();
  return await db.select().from(saleItems).where(eq(saleItems.saleId, saleId));
}

// ============ CASH TRANSACTIONS ============

export async function createCashTransaction(transaction: {
  type: "entrada" | "saida";
  amount: string;
  description: string;
  saleId?: number;
  userId: number;
}) {
  const db = await getPdvDb();
  return await db.insert(cashTransactions).values(transaction as any);
}

export async function getAllCashTransactions() {
  const db = await getPdvDb();
  return await db.select().from(cashTransactions).orderBy(desc(cashTransactions.createdAt));
}

export async function getCashTransactionsByDateRange(startDate: Date, endDate: Date) {
  const db = await getPdvDb();
  return await db.select().from(cashTransactions).where(
    and(gte(cashTransactions.createdAt, startDate), lte(cashTransactions.createdAt, endDate))
  ).orderBy(desc(cashTransactions.createdAt));
}

export async function getCashBalance() {
  const db = await getPdvDb();
  const result = await db.select({
    balance: sql<number>`
      SUM(CASE
        WHEN ${cashTransactions.type} = 'entrada' THEN ${cashTransactions.amount}
        WHEN ${cashTransactions.type} = 'saida' THEN -${cashTransactions.amount}
        ELSE 0
      END)
    `,
  }).from(cashTransactions);
  return result[0]?.balance || 0;
}

// ============ DASHBOARD ============

export async function getDashboardStats() {
  const db = await getPdvDb();

  // Limites do dia de "hoje" no fuso America/Sao_Paulo. Calculamos no Node e
  // filtramos no SQL — assim NÃO baixamos a tabela de vendas inteira. Como a
  // coluna é TIMESTAMP (instante), 00:00 BRT equivale a 03:00 UTC; o intervalo
  // [startOfDay, endOfDay) seleciona exatamente as mesmas vendas que a antiga
  // comparação de data feita em JS.
  //
  // PREMISSA: BRT = UTC-3 fixo (horário de verão abolido em 2019); revisar se o
  // DST voltar. Derivamos a data-calendário subtraindo 3h ANTES de extrair o
  // YYYY-MM-DD — senão, entre 21:00 e 23:59 BRT, o UTC já estaria no dia seguinte
  // e "Vendas Hoje" mostraria o dia errado bem na hora do fechamento do caixa.
  const now = new Date();
  const brtNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const todayStr = brtNow.toISOString().split("T")[0]; // "YYYY-MM-DD" em BRT
  const startOfDay = new Date(`${todayStr}T03:00:00.000Z`); // 00:00 BRT
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000); // 00:00 BRT do dia seguinte

  const [todayAgg, lowStock, topProducts, balance] = await Promise.all([
    // Total e contagem das vendas de hoje (ignorando canceladas), agregados no SQL.
    db.select({
      total: sql<string | null>`SUM(${sales.total})`,
      count: sql<number>`COUNT(*)`,
    }).from(sales).where(
      and(
        gte(sales.createdAt, startOfDay),
        lt(sales.createdAt, endOfDay),
        eq(sales.canceled, false),
      )
    ),
    getLowStockProducts(),
    db.select({
      productId: saleItems.productId,
      productName: saleItems.productName,
      totalQuantity: sql<number>`SUM(${saleItems.quantity})`,
      totalRevenue: sql<number>`SUM(${saleItems.subtotal})`,
    }).from(saleItems)
      .groupBy(saleItems.productId, saleItems.productName)
      .orderBy(desc(sql`SUM(${saleItems.quantity})`))
      .limit(10),
    getCashBalance(),
  ]);

  const todayTotal = Number(todayAgg[0]?.total ?? 0);
  const todayCount = Number(todayAgg[0]?.count ?? 0);

  return {
    todaySales: { total: todayTotal, count: todayCount },
    lowStockCount: lowStock.length,
    lowStockProducts: lowStock,
    topProducts,
    cashBalance: balance,
  };
}

// ============ CUSTOMERS ============

export async function getAllCustomers() {
  const db = await getPdvDb();
  return await db.select().from(customers).orderBy(desc(customers.createdAt));
}

export async function getCustomerById(id: number) {
  const db = await getPdvDb();
  const result = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return result[0];
}

export async function searchCustomers(query: string) {
  const db = await getPdvDb();
  return await db.select().from(customers).where(
    sql`${customers.name} LIKE ${`%${query}%`} OR ${customers.cpfCnpj} LIKE ${`%${query}%`} OR ${customers.phone} LIKE ${`%${query}%`}`
  ).orderBy(asc(customers.name)).limit(20);
}

export async function createCustomer(data: { name: string; cpfCnpj?: string; phone?: string; email?: string }) {
  const db = await getPdvDb();
  return await db.insert(customers).values(data as any);
}

export async function updateCustomer(id: number, data: Partial<{ name: string; cpfCnpj: string; phone: string; email: string }>) {
  const db = await getPdvDb();
  return await db.update(customers).set(data as any).where(eq(customers.id, id));
}

export async function deleteCustomer(id: number) {
  const db = await getPdvDb();
  return await db.delete(customers).where(eq(customers.id, id));
}

// ============ BACKUP ============

export async function generateFullBackup() {
  const db = await getPdvDb();
  const [allProducts, allCategories, allSales, allSaleItems, allCashTransactions, allCustomers] =
    await Promise.all([
      db.select().from(products),
      db.select().from(categories),
      db.select().from(sales),
      db.select().from(saleItems),
      db.select().from(cashTransactions),
      db.select().from(customers),
    ]);
  return {
    timestamp: new Date().toISOString(),
    version: "1.0",
    tables: { products: allProducts, categories: allCategories, sales: allSales, saleItems: allSaleItems, cashTransactions: allCashTransactions, customers: allCustomers },
    metadata: {
      productsCount: allProducts.length,
      categoriesCount: allCategories.length,
      salesCount: allSales.length,
      saleItemsCount: allSaleItems.length,
      cashTransactionsCount: allCashTransactions.length,
      customersCount: allCustomers.length,
    },
  };
}
