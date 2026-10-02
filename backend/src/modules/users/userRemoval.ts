/**
 * Whether a member can be removed from the workspace for good.
 *
 * Pure and tested without a database, because both refusals guard against
 * the same unrecoverable outcome: a workspace nobody can administer. There
 * is nothing in the product that promotes a SUB_USER, so an admin who
 * removes the last admin — or themselves — has no way back in, and no
 * support path short of editing the database by hand.
 */

export interface RemovalRefusal {
  code: string;
  message: string;
  /** Which HTTP shape the caller should raise — these two are not the same kind of wrong. */
  kind: 'bad_request' | 'conflict';
}

export function refuseUserRemoval(input: {
  actorUserId: string;
  targetUserId: string;
  targetRole: string;
  /** How many MASTER_ADMINs the workspace has, including the target. */
  masterAdminCount: number;
}): RemovalRefusal | null {
  if (input.actorUserId === input.targetUserId) {
    return {
      kind: 'bad_request',
      code: 'CANNOT_REMOVE_SELF',
      message:
        'You cannot remove your own account — you would be locked out immediately. Ask another admin.',
    };
  }

  if (input.targetRole === 'MASTER_ADMIN' && input.masterAdminCount <= 1) {
    return {
      kind: 'conflict',
      code: 'LAST_ADMIN',
      message:
        'This is the only admin in the workspace. Removing it would leave nobody able to manage users, ' +
        'numbers or credentials. Make someone else an admin first.',
    };
  }

  return null;
}
