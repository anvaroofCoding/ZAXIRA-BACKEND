import mongoose from 'mongoose';

function userIdValues(userId) {
  const values = [new mongoose.Types.ObjectId(userId)];
  if (mongoose.Types.ObjectId.isValid(userId)) values.push(userId);
  return values;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildApprovalInboxLoginFieldClause(field, viewerLogin) {
  const normalizedLogin = viewerLogin?.trim().toLowerCase();
  if (!normalizedLogin) return null;
  return {
    [field]: { $regex: new RegExp(`^${escapeRegex(normalizedLogin)}$`, 'i') },
  };
}

function buildApprovalInboxAssignmentClause(userId, viewerLogin) {
  const userIdValuesArr = userIdValues(userId);
  const branches = [
  {
    $or: [
      { 'boss.userId': { $in: userIdValuesArr } },
      ...(viewerLogin
        ? [{ 'boss.login': buildApprovalInboxLoginFieldClause('boss.login', viewerLogin)['boss.login'] }]
        : []),
    ],
  },
  {
    $or: [
      { commissionMembers: { $elemMatch: { userId: { $in: userIdValuesArr } } } },
      ...(viewerLogin
        ? [
            {
              commissionMembers: {
                $elemMatch: buildApprovalInboxLoginFieldClause('login', viewerLogin),
              },
            },
          ]
        : []),
    ],
  },
  { approvalParticipantUserIds: { $in: userIdValuesArr } },
  {
    memberDecisions: {
      $elemMatch: { userId: { $in: userIdValuesArr } },
    },
  },
  ];
  if (viewerLogin) {
    const loginClause = buildApprovalInboxLoginFieldClause('login', viewerLogin);
    branches.push({
      memberDecisions: { $elemMatch: loginClause },
    });
  }
  return { $or: branches };
}

const uri = 'mongodb://127.0.0.1:27017/zaxira';
await mongoose.connect(uri);
const db = mongoose.connection.db;
const nh = await db.collection('users').findOne({ login: 'nh' });
const filter = buildApprovalInboxAssignmentClause(String(nh._id), 'nh');
const count = await db.collection('purchase_requests').countDocuments(filter);
const rows = await db.collection('purchase_requests').find(filter).project({ requestCode: 1, status: 1 }).toArray();
console.log('filter count:', count);
console.log(rows.map((r) => `${r.requestCode}(${r.status})`).join(', '));
await mongoose.disconnect();
