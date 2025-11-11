const MySQLAdapter = require("./adapters/MySQLAdapter");
const SQLiteAdapter = require("./adapters/SQLiteAdapter");
require("dotenv").config();

class DatabaseFactory {
  static createAdapter(type = null) {
    const dbType = type || process.env.DB_TYPE || "mysql";

    switch (dbType.toLowerCase()) {
      case "mysql":
        const config = {
          host: process.env.MYSQL_HOST || process.env.DATABASEHOST || 'localhost',
          port: parseInt(process.env.MYSQL_PORT || '3306', 10),
          user: process.env.MYSQL_USER || process.env.DATABASEUSER,
          password: process.env.MYSQL_PASSWORD || process.env.DATABASEPASSWORD,
          database: process.env.MYSQL_DATABASE || process.env.DATABASE,
        };
        console.log('MySQL config:', { ...config, password: '***' });
        return new MySQLAdapter(config);

      case "sqlite":
        return new SQLiteAdapter({
          database: process.env.SQLITE_PATH || "./data/database.db",
        });

      default:
        throw new Error(`Unsupported database type: ${dbType}`);
    }
  }

  static async createAndConnect(type = null) {
    const adapter = this.createAdapter(type);
    await adapter.connect();
    return adapter;
  }
}

module.exports = DatabaseFactory;
