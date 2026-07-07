require('dotenv').config();
const fs=require('fs'),mysql=require('mysql2/promise');
(async()=>{
  const c=await mysql.createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  const q=async(s,p)=>{const[r]=await c.query(s,p);return r;};
  const teachers=await q("SELECT id,name,specialization FROM teachers WHERE is_deleted=FALSE AND specialization IS NOT NULL AND specialization<>''");
  const removed=[]; const backup=[];
  for(const t of teachers){
    const subs=t.specialization.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
    const stray=await q(`SELECT m.id, s.form_no, s.full_name, sub.name subject
      FROM student_teacher_mapping m JOIN students s ON s.id=m.student_id JOIN subjects sub ON sub.id=m.subject_id
      WHERE m.teacher_id=? AND LOWER(sub.name) NOT IN (${subs.map(()=>'?').join(',')})`,[t.id,...subs]);
    if(stray.length){
      removed.push(`${t.name} [keeps: ${t.specialization}] -> remove ${stray.length}: `+stray.map(r=>`${r.full_name}(${r.subject})`).join('; '));
      const rows=await q("SELECT * FROM student_teacher_mapping m JOIN subjects sub ON sub.id=m.subject_id WHERE m.teacher_id=? AND LOWER(sub.name) NOT IN ("+subs.map(()=>'?').join(',')+")",[t.id,...subs]);
      backup.push(...rows);
      await q(`DELETE m FROM student_teacher_mapping m JOIN subjects sub ON sub.id=m.subject_id WHERE m.teacher_id=? AND LOWER(sub.name) NOT IN (${subs.map(()=>'?').join(',')})`,[t.id,...subs]);
    }
  }
  fs.writeFileSync('scripts/cleanup-teacher-mappings-backup.json',JSON.stringify(backup,null,2));
  console.log(removed.length?removed.join('\n'):'Nothing to remove.');
  console.log('\nTotal rows removed:',backup.length);
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
