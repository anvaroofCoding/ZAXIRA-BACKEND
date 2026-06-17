import mongoose from 'mongoose';

function userIdValues(userId) {
  const values = [new mongoose.Types.ObjectId(userId)];
  if (mongoose.Types.ObjectId.isValid(userId)) values.push(userId);
  return values;
}

function assignmentClause(userId, login) {
  const userIdValuesArr = userIdValues(userId);
  const branches = [
    { 'boss.userId': { $in: userIdValuesArr } },
    { commissionMembers: { $elemMatch: { userId: { $in: userIdValuesArr } } } },
    { approvalParticipantUserIds: { $in: userIdValuesArr } },
    { memberDecisions: { $elemMatch: { userId: { $in: userIdValuesArr } } } },
  ];
  if (login) {
    const re = new RegExp(
      `^${login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
      'i',
    );
    branches.push({ 'boss.login': re });
    branches.push({ commissionMembers: { $elemMatch: { login: re } } });
    branches.push({ memberDecisions: { $elemMatch: { login: re } } });
  }
  return { $or: branches };
}

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/zaxira';
await mongoose.connect(uri);
const db = mongoose.connection.db;
const users = await db.collection('users').find({}).project({ login: 1 }).toArray();

for (const u of users) {
  const login = u.login;
  const filter = assignmentClause(String(u._id), login);
  const rows = await db
    .collection('purchase_requests')
    .find(filter)
    .project({ requestCode: 1, status: 1 })
    .toArray();
  console.log(
    `${login}: ${rows.length} -> ${rows.map((r) => `${r.requestCode}(${r.status})`).join(', ')}`,
  );
}

await mongoose.disconnect();
