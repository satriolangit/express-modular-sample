const users = [
  { id: 1, name: "Alice", email: "alice@example.com" },
  { id: 2, name: "Bob", email: "bob@example.com" },
];
const roles = [
  { id: 1, user_id: 1, name: "admin" },
  { id: 2, user_id: 2, name: "viewer" },
];
const products = [
  { id: 1, name: "Widget", price: 10 },
  { id: 2, name: "Gadget", price: 20 },
];
const policies = [{ id: 1, name: "default", rule: "allow-all" }];
const auditLogs = [];

module.exports = {
  async query(sql, params = []) {
    if (/FROM users/i.test(sql) && /WHERE id/i.test(sql)) {
      return users.filter((u) => u.id === params[0]);
    }
    if (/FROM users/i.test(sql)) return users;
    if (/FROM roles/i.test(sql) && /user_id/i.test(sql)) {
      return roles.filter((r) => r.user_id === params[0]);
    }
    if (/FROM roles/i.test(sql)) return roles;
    if (/FROM products/i.test(sql) && /WHERE id/i.test(sql)) {
      return products.filter((p) => p.id === params[0]);
    }
    if (/FROM products/i.test(sql)) return products;
    if (/FROM policies/i.test(sql) && /WHERE id/i.test(sql)) {
      return policies.filter((p) => p.id === params[0]);
    }
    if (/FROM policies/i.test(sql)) return policies;
    if (/FROM audit_logs/i.test(sql) && /user_id/i.test(sql)) {
      return auditLogs.filter((a) => a.user_id === params[0]);
    }
    if (/FROM audit_logs/i.test(sql)) return auditLogs;
    return [];
  },

  async insert(table, row) {
    if (table === "audit_logs") {
      const newRow = {
        id: auditLogs.length + 1,
        ...row,
        created_at: new Date().toISOString(),
      };
      auditLogs.push(newRow);
      return newRow;
    }
    throw new Error(`Unknown table: ${table}`);
  },
};
