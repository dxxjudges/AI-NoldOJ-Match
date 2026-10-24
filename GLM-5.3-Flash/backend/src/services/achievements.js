const { one, all, run } = require('../db/db');

// Achievement definitions (code -> check fn). Extendable.
const DEFS = [
  { code: 'first_blood', name: 'First Blood', desc: 'First time an AC is obtained', check: (ctx) => ctx.acCount >= 1 },
  { code: 'streak_7', name: 'Persistently Hardworking', desc: 'Important things done three times (submissions on 7 different days)', check: (ctx) => ctx.distinctDays >= 7 },
  { code: 'streak_30', name: 'Like Clockwork', desc: 'Submissions on 30 different days', check: (ctx) => ctx.distinctDays >= 30 },
  { code: 'ac_10', name: 'Getting the Hang of It', desc: '10 total ACs', check: (ctx) => ctx.acCount >= 10 },
  { code: 'ac_50', name: 'AC Machine', desc: '50 total ACs', check: (ctx) => ctx.acCount >= 50 },
  { code: 'sub_100', name: 'Collection Expert', desc: '100 total submissions', check: (ctx) => ctx.subCount >= 100 },
  { code: 'difficulty_ac_quarter', name: 'Climbing Bravely', desc: 'First AC of a Very Hard or Expert problem', check: (ctx) => ctx.hardAc >= 1 },
  { code: 'contest_first', name: 'To the Arena', desc: 'First participation in an online contest', check: (ctx) => ctx.contestsJoined >= 1 }
];

function computeCtx(userId) {
  const acCount = one(`SELECT COUNT(*) c FROM submissions WHERE user_id=? AND status='ac'`, userId)?.c || 0;
  const subCount = one(`SELECT COUNT(*) c FROM submissions WHERE user_id=? AND is_ide=0`, userId)?.c || 0;
  const distinctDays = one(
    `SELECT COUNT(DISTINCT date(created_at/1000, 'unixepoch')) c FROM submissions WHERE user_id=? AND is_ide=0`,
    userId)?.c || 0;
  const hardAc = one(
    `SELECT COUNT(*) c FROM submissions s JOIN problems p ON p.id=s.problem_id WHERE s.user_id=? AND s.status='ac' AND p.difficulty>=4`,
    userId)?.c || 0;
  const contestsJoined = one(`SELECT COUNT(*) c FROM contest_participants WHERE user_id=?`, userId)?.c || 0;
  return { acCount, subCount, distinctDays, hardAc, contestsJoined };
}

function checkAchievements(userId) {
  const ctx = computeCtx(userId);
  const unlocked = new Set(all(`SELECT code FROM achievements WHERE user_id=?`, userId).map(r => r.code));
  for (const d of DEFS) {
    if (!unlocked.has(d.code) && d.check(ctx)) {
      run(`INSERT INTO achievements (user_id, code, unlocked_at) VALUES (?,?,?)`, userId, d.code, Date.now());
    }
  }
  // also fill missing unlocked flags that no longer qualify? keep (once earned forever)
  return DEFS.filter(d => !unlocked.has(d.code) && d.check(ctx));
}

function listAchievements(userId) {
  const unlocked = new Map(all(`SELECT code, unlocked_at FROM achievements WHERE user_id=?`, userId).map(r => [r.code, r.unlocked_at]));
  return DEFS.map(d => ({
    code: d.code, name: d.name, desc: d.desc,
    unlocked: unlocked.has(d.code),
    unlockedAt: unlocked.get(d.code) || null
  }));
}

module.exports = { checkAchievements, listAchievements, DEFS };
