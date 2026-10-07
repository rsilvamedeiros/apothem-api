import { and, eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import type { NotePort } from '../application/note.port.js';
import { workspaceNotes, type NewWorkspaceNote, type WorkspaceNote } from './schema.js';

export class NoteRepository implements NotePort {
  constructor(private readonly db: Database) {}

  async create(input: NewWorkspaceNote): Promise<WorkspaceNote> {
    const [row] = await this.db.insert(workspaceNotes).values(input).returning();
    if (!row) {
      throw new Error('Failed to create note');
    }
    return row;
  }

  async findByIdempotencyKey(workspaceId: string, key: string): Promise<WorkspaceNote | undefined> {
    const [row] = await this.db
      .select()
      .from(workspaceNotes)
      .where(and(eq(workspaceNotes.workspaceId, workspaceId), eq(workspaceNotes.idempotencyKey, key)))
      .limit(1);
    return row;
  }
}
