import mysql from "mysql2/promise";

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);

  try {
    // Criar tabela admins
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(320) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        profilePhoto LONGTEXT,
        customLabel LONGTEXT,
        active INT DEFAULT 1 NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        lastLogin TIMESTAMP
      )
    `);
    console.log("✅ Tabela admins criada com sucesso!");

    // Inserir admin padrão
    const bcrypt = await import("bcryptjs");
    const hashedPassword = await bcrypt.hash("011992", 10);

    await connection.execute(
      `INSERT INTO admins (username, email, password, name, active) VALUES (?, ?, ?, ?, ?)`,
      ["jnc bombas", "contato@soluteg.com", hashedPassword, "JNC Elétrica e Bombas Ltda", 1]
    );
    console.log("✅ Admin padrão criado: jnc bombas / 011992");

    // Verificar
    const [rows] = await connection.execute(`SELECT id, username, email FROM admins`);
    console.log("✅ Admins no banco:", rows);

  } catch (error) {
    console.error("❌ Erro:", error.message);
  } finally {
    await connection.end();
  }
}

main();
