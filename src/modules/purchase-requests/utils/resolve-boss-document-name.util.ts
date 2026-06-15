import { UsersService } from '../../users/users.service';
import { UserSnapshotEmbeddable } from '../schemas/user-snapshot.schema';

export async function resolveBossDocumentName(
  boss: UserSnapshotEmbeddable,
  usersService: UsersService,
): Promise<string> {
  const snapshotName = boss.structureLeaderName?.trim();
  if (snapshotName) {
    return snapshotName;
  }

  try {
    const structure = await usersService.resolveStructureSnapshotForUser(
      String(boss.userId),
    );
    const leaderName = structure?.leaderName?.trim();
    if (leaderName) {
      return leaderName;
    }
  } catch {
    // foydalanuvchi topilmasa yoki tuzilma yo‘q bo‘lsa
  }

  return boss.displayName || boss.login;
}
