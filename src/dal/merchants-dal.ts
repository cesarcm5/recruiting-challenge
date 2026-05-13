import { db } from '../db.js';

export interface MerchantRow {
  id: string;
  name: string;
  password_hash: string | null;
  created_at: string;
}

export const merchantsDal = {
  getById(id: string): MerchantRow | undefined {
    return db
      .prepare(`SELECT * FROM merchants WHERE id = ?`)
      .get(id) as MerchantRow | undefined;
  },

  setPasswordHash(id: string, passwordHash: string): void {
    db.prepare(`UPDATE merchants SET password_hash = ? WHERE id = ?`).run(passwordHash, id);
  },
};
