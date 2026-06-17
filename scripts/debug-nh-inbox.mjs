import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/zaxira';
await mongoose.connect(uri);
const db = mongoose.connection.db;

const nh = await db.collection('users').findOne({ login: 'nh' });
console.log('nh userId:', nh?._id);

const reqs = await db.collection('purchase_requests').find({}).project({
  requestCode: 1,
  status: 1,
  boss: 1,
  commissionMembers: 1,
  approvalParticipantUserIds: 1,
  memberDecisions: 1,
}).toArray();

let nhMatches = [];
for (const r of reqs) {
  const uid = String(nh._id);
  const inBoss = String(r.boss?.userId) === uid;
  const inCommission = (r.commissionMembers || []).some(
    (m) => String(m.userId) === uid || m.login?.toLowerCase() === 'nh',
  );
  const inParticipants = (r.approvalParticipantUserIds || []).some(
    (id) => String(id) === uid,
  );
  const inDecisions = (r.memberDecisions || []).some(
    (d) => String(d.userId) === uid || d.login?.toLowerCase() === 'nh',
  );
  if (inBoss || inCommission || inParticipants || inDecisions) {
    nhMatches.push({
      code: r.requestCode,
      status: r.status,
      inBoss,
      inCommission,
      inParticipants,
      inDecisions,
    });
  }
}

console.log(`nh matches: ${nhMatches.length}`);
for (const m of nhMatches) {
  console.log(m);
}

await mongoose.disconnect();
