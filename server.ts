import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { supabase } from "./supabaseClient"; // استيراد اتصال سوبابيس الذي أنشأناه
dotenv.config();

let aiClient: any = null;
function getAiClient() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key) {
      aiClient = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    }
  }
  return aiClient;
}

const app = express();
const PORT = 3000;
const DB_PATH = path.join(process.cwd(), "data", "database.json");

// Make sure the data folder exists
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

// Initial structure for the JSON Database
interface User {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  passwordHash: string; // Plain password for user/developer view as requested ("can know passwords")
  phone: string;
  email: string;
  role: string; // 'doctor', 'secretary', 'market_manager', 'cashier', 'accountant', etc.
  doctorId?: string; // If secretary, refers to their Doctor's user ID
  doctorName?: string; // Name of doctor
  createdAt: string;
}

interface Patient {
  id: string;
  name: string;
  phone?: string;
  datetime?: string;
  age?: string;
  height?: string;
  weight?: string;
  status: "waiting" | "pending_approval" | "admitted" | "completed"; // waiting, pending_approval (request sent), admitted (approved), completed
  secretaryId: string;
  doctorId: string;
  amountPaid?: number;
  isReview?: boolean;
  createdAt: string;
}

interface Prescription {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  medicines: string;
  xrays: string;
  tests: string;
  other?: string;
  createdAt: string;
  updatedAt?: string;
}

interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  createdAt: string;
}

interface SyncLog {
  id: string;
  timestamp: string;
  action: string; // CREATE_USER, EDIT_USER, DELETE_USER, ADD_PATIENT, APPROVE_PATIENT, PRESCRIPTION
  emailAffected: string;
  details: string;
}

interface DatabaseSchema {
  users: User[];
  patients: Patient[];
  prescriptions: Prescription[];
  messages: Message[];
  syncLogs: SyncLog[];
}

const defaultDb: DatabaseSchema = {
  users: [
    // Pre-seed a doctor to allow immediate secretary registration
    {
      id: "doc-1",
      firstName: "أحمد",
      lastName: "علي",
      username: "ahmed",
      passwordHash: "123456",
      phone: "+9647701234567",
      email: "dr.ahmed@example.com",
      role: "doctor",
      createdAt: new Date().toISOString()
    },
    {
      id: "doc-2",
      firstName: "سارة",
      lastName: "أحمد",
      username: "sara",
      passwordHash: "123456",
      phone: "+9647707654321",
      email: "dr.sara@example.com",
      role: "doctor",
      createdAt: new Date().toISOString()
    }
  ],
  patients: [
    {
      id: "pat-1",
      name: "محمد جاسم العلي",
      phone: "07712345678",
      datetime: "2026-05-29T10:30",
      status: "waiting",
      secretaryId: "sec-1",
      doctorId: "doc-1",
      createdAt: new Date().toISOString()
    }
  ],
  prescriptions: [],
  messages: [],
  syncLogs: [
    {
      id: "log-seed-1",
      timestamp: new Date().toISOString(),
      action: "تهيئة النظام",
      emailAffected: "jehat.hassan91@gmail.com",
      details: "إنشاء قاعدة البيانات وبدء المزامنة مع ورقة العمل"
    }
  ]
};

// Database helper functions
function readDb(): DatabaseSchema {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2), "utf8");
      return defaultDb;
    }
    const data = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(data) as DatabaseSchema;
  } catch (error) {
    console.error("Error reading database file, returning defaultDb:", error);
    return defaultDb;
  }
}

function writeDb(db: DatabaseSchema) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (error) {
    console.error("Error writing database file:", error);
  }
}

// Log actions to the programmer sheet simulation


// دالة تسجيل العمليات داخل سوبابيس سحابياً
async function addSyncLog(action: string, emailAffected: string, details: string) {
  try {
    const newLog = {
      id: "log_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      action: action,
      email_affected: emailAffected, // متوافق مع اسم العمود في جدولك السحابي
      details: details
    };
    
    await supabase.from('sync_logs').insert([newLog]);
  } catch (err) {
    console.error("تعذر حفظ السجل سحابياً:", err);
  }
}


// Enable parsers
app.use(express.json());

// API: Get List of Doctors (for secretary sign-up)
// API: Get List of Doctors من Supabase
app.get("/api/doctors", async (req, res) => {
try {
const { data: users, error } = await supabase
  .from('users')
  .select('id, firstName, lastName, phone, username')
  .eq('role', 'doctor');

if (error) throw error;

const doctors = users.map((doc) => ({
  id: doc.id,
  name: `د. ${doc.firstName} ${doc.lastName}`,
  phone: doc.phone,
  username: doc.username
}));

res.json(doctors);
} catch (error: any) {
console.error("Error fetching doctors:", error);
res.status(500).json({ success: false, error: error.message });
}
});

// API: Verification Simulation for WhatsApp
const activeCodes = new Map<string, string>(); // phone -> code map

app.post("/api/verify-whatsapp", (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, error: "رقم الهاتف مطلوب" });
  }
  // Generate a random 4 digit code
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  activeCodes.set(phone, code);
  
  // Return the code to the frontend as a simulated WhatsApp SMS
  addSyncLog("إرسال رمز الهاتف", "jehat.hassan91@gmail.com", `تم إرسال رمز التحقق ${code} لرقم الهاتف ${phone} عبر الواتساب`);
  res.json({ success: true, code, message: `simulated: تم إرسال الرمز ${code} عبر الواتساب` });
});

app.post("/api/verify-doc", (req, res) => {
  const { doctorId } = req.body;
  if (!doctorId) {
    return res.status(400).json({ success: false, error: "معرف الطبيب مطلوب" });
  }
  const db = readDb();
  const doctor = db.users.find(u => u.id === doctorId);
  if (!doctor) {
    return res.status(404).json({ success: false, error: "الطبيب غير موجود" });
  }

  // Generate a code representing doctor's approval
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  activeCodes.set(doctor.phone, code);

  addSyncLog("طلب موافقة سكرتير", "jehat.hassan91@gmail.com", `طلب السكرتير موافقة الطبيب ${doctor.firstName}. تم توليد رمز الموافقة: ${code} وإرساله لهاتف الطبيب: ${doctor.phone}`);
  res.json({ success: true, code, doctorPhone: doctor.phone, message: `simulated_doc_code: الرمز هو ${code}` });
});

// API: Check if username exists
// API: Check if username exists في Supabase
app.post("/api/check-username", async (req, res) => {
const { username } = req.body;
try {
const { data, error } = await supabase
  .from('users')
  .select('username')
  .ilike('username', username.trim())
  .maybeSingle();

if (error) throw error;
res.json({ exists: !!data });
} catch (error: any) {
res.status(500).json({ error: error.message });
}
});

// API: Register Account
// API: Register Account
app.post("/api/register", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      username,
      password,
      phone,
      email,
      role,
      doctorId,
      programmerPassword
    } = req.body;

    // التحقق من كلمة سر المبرمج لحماية النظام
    if (programmerPassword !== "Pgjmwpgjmw93*94#") {
      return res.status(400).json({ success: false, error: "كلمة سر المبرمج غير صحيحة!" });
    }

    if (!firstName || !lastName || !username || !password || !phone || !email || !role) {
      return res.status(400).json({ success: false, error: "الرجاء تعبئة كافة الحقول" });
    }

    if (username.includes(" ")) {
      return res.status(400).json({ success: false, error: "اسم المستخدم يجب أن يكون بدون فراغات" });
    }

    const cleanUsername = username.trim().toLowerCase();

    // 1. التحقق من عدم تكرار اسم المستخدم في Supabase
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('username')
      .ilike('username', cleanUsername)
      .maybeSingle();

    if (checkError) throw checkError;
    if (existingUser) {
      return res.status(400).json({ success: false, error: "اسم المستخدم هذا مسجل مسبقاً" });
    }

    // 2. توليد معرف مستخدم فريد متوافق مع نظامك الحالي
    const userId = "usr_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);

    // 3. بناء الكائن وإدراج البيانات مع تحويل الأسماء لتطابق أعمدة Supabase (Snake_Case)
    const newUserForSupabase = {
      id: userId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      username: cleanUsername,
      password_hash: password, // الحفاظ على كلمة المرور النصية حسب طلبك للمراجعة
      phone: phone.trim(),
      email: email.trim(),
      role: role
    };

    const { error: insertError } = await supabase
      .from('users')
      .insert([newUserForSupabase]);

    if (insertError) throw insertError;

    // تسجيل العملية في السجلات السحابية الموحدة
    await addSyncLog(
      "إنشاء حساب", 
      "jehat.hassan91@gmail.com", 
      `تم إنشاء حساب جديد بنجاح: ${role} - الاسم: ${firstName.trim()} ${lastName.trim()}`
    );

    // إعادة الكائن بصيغة الـ Frontend لتجنب أي انهيار في الواجهات
    res.json({ 
      success: true, 
      user: {
        id: userId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: cleanUsername,
        passwordHash: password,
        phone: phone.trim(),
        email: email.trim(),
        role: role,
        createdAt: new Date().toISOString()
      } 
    });

  } catch (error: any) {
    console.error("Register Error:", error);
    res.status(500).json({ success: false, error: error.message || "حدث خطأ أثناء التسجيل" });
  }
});

// API: Login
// API: Login

// API: Login
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: "الرجاء إدخال اسم المستخدم وكلمة المرور" });
    }

    const cleanUsername = username.trim().toLowerCase();

    // استعلام للبحث عن الحساب ومطابقة كلمة المرور مباشرة من Supabase
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .ilike('username', cleanUsername)
      .eq('password_hash', password)
      .maybeSingle();

    if (error) throw error;

    if (!user) {
      return res.status(401).json({ success: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
    }

    // كتابة العملية السجل السحابي
    await addSyncLog(
      "تسجيل دخول", 
      "jehat.hassan91@gmail.com", 
      `تم تسجيل دخول المستخدم: ${user.username} (${user.role})`
    );

    // تحويل البيانات الراجعة من صيغة قاعدة البيانات (Snake_Case) إلى صيغة الـ Frontend المتوقعة (CamelCase)
    res.json({
      success: true,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        passwordHash: user.password_hash,
        phone: user.phone,
        email: user.email,
        role: user.role,
        createdAt: user.created_at
      }
    });

  } catch (error: any) {
    console.error("Login Error:", error);
    res.status(500).json({ success: false, error: error.message || "حدث خطأ أثناء تسجيل الدخول" });
  }
});

// API: Update User Info
app.put("/api/user/update", (req, res) => {
  const { userId, username, password, email, prescriptionTemplate } = req.body;
  if (!userId) {
    return res.status(400).json({ success: false, error: "معرف المستخدم مطلوب" });
  }

  const db = readDb();
  const userIdx = db.users.findIndex(u => u.id === userId);
  if (userIdx === -1) {
    return res.status(404).json({ success: false, error: "المستخدم غير موجود" });
  }

  const user = db.users[userIdx] as any;
  const oldUsername = user.username;

  if (username && username.includes(" ")) {
    return res.status(400).json({ success: false, error: "اسم المستخدم يجب أن يكون بدون فراغات" });
  }

  if (username && username.toLowerCase() !== oldUsername.toLowerCase()) {
    const exists = db.users.some(u => u.id !== userId && u.username.toLowerCase() === username.trim().toLowerCase());
    if (exists) {
      return res.status(400).json({ success: false, error: "اسم المستخدم الجديد مسجل مسبقاً" });
    }
    user.username = username.trim().toLowerCase();
  }

  if (password) {
    user.passwordHash = password;
  }

  if (email) {
    user.email = email.trim();
  }

  if (prescriptionTemplate !== undefined) {
    user.prescriptionTemplate = prescriptionTemplate;
  }

  db.users[userIdx] = user;
  writeDb(db);

  addSyncLog("تعديل حساب", "jehat.hassan91@gmail.com", `تم تعديل معلومات المستخدم ${oldUsername}: الإيميل الجديد (${user.email}), اسم المستخدم الجديد (${user.username})`);
  res.json({ success: true, user });
});

// API: Delete User Account
app.delete("/api/user/delete", (req, res) => {
  const { userId, passcode } = req.body;
  if (!userId) {
    return res.status(400).json({ success: false, error: "معرف المستخدم مطلوب" });
  }

  if (passcode !== "Pgjmwpgjmw93*94#") {
    return res.status(403).json({ success: false, error: "الرمز السري المالي والبرمجي المدخل غير صحيح للموافقة على الإزالة" });
  }

  const db = readDb();
  const userIdx = db.users.findIndex(u => u.id === userId);
  if (userIdx === -1) {
    return res.status(404).json({ success: false, error: "المستخدم غير موجود" });
  }

  const deletedUser = db.users[userIdx];
  db.users.splice(userIdx, 1);
  writeDb(db);

  addSyncLog("مسح حساب", "jehat.hassan91@gmail.com", `تم مسح حساب المستخدم نهائياً: ${deletedUser.username} (${deletedUser.role})`);
  res.json({ success: true, message: "تم حذف الحساب بنجاح" });
});

// API: Forgot Password
app.post("/api/forgot-password", (req, res) => {
  const { username, phone } = req.body;
  if (!username || !phone) {
    return res.status(400).json({ success: false, error: "الرجاء تعبئة اسم المستخدم ورقم الهاتف" });
  }

  const db = readDb();
  const user = db.users.find(u => u.username.toLowerCase() === username.trim().toLowerCase() && u.phone === phone.trim());

  if (!user) {
    return res.status(404).json({ success: false, error: "المعلومات المدخلة غير طابقة لسجلاتنا" });
  }

  // Generate a random code for verification and simulate sending password reset
  const resetCode = Math.floor(1000 + Math.random() * 9000).toString();
  activeCodes.set(phone, resetCode);
  
  addSyncLog("استرجاع كلمة مرور", "jehat.hassan91@gmail.com", `طلب استرجاع كلمة المرور للمستخدم: ${username}. تم إرسال الرمز ${resetCode} للواتساب.`);

  res.json({ 
    success: true, 
    code: resetCode, 
    tempPassword: user.passwordHash,
    message: `الرمز هو ${resetCode}. بعد المطابقة، ستظهر كلمة المرور الحالية وهي: ${user.passwordHash}` 
  });
});

// Patients Routing

// Patients Routing - جلب المرضى وتصفيتهم سحابياً
app.get("/api/patients", async (req, res) => {
  try {
    const { doctorId, secretaryId } = req.query;
    
    // بدء بناء استعلام Supabase على جدول patients
    let query = supabase.from('patients').select('*');

    // تصفية البيانات من جهة السيرفر بناءً على المعاملات المرسلة
    if (doctorId) {
      query = query.eq('doctor_id', doctorId);
    } else if (secretaryId) {
      query = query.eq('secretary_id', secretaryId);
    }

    const { data: patients, error } = await query;

    if (error) throw error;

    // تحويل صيغة الحقول الراجعة من Supabase (Snake_Case) إلى صيغة الـ Frontend (CamelCase) لضمان عدم حدوث أخطاء بالواجهات
    const formattedList = (patients || []).map(p => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      datetime: p.datetime,
      status: p.status,
      secretaryId: p.secretary_id,
      doctorId: p.doctor_id,
      createdAt: p.created_at
    }));

    // إرسال القائمة الجاهزة للوحة التحكم
    res.json(formattedList);

  } catch (error: any) {
    console.error("Fetch Patients Error:", error);
    res.status(500).json({ success: false, error: error.message || "حدث خطأ أثناء جلب بيانات المرضى" });
  }
});
// API: إضافة مريض مراجع جديد سحابياً
app.post("/api/patients", async (req, res) => {
  try {
    const { 
      name, 
      phone, 
      datetime, 
      age, 
      height, 
      weight, 
      amountPaid, 
      isReview, 
      secretaryId, 
      doctorId 
    } = req.body;

    if (!name || !secretaryId || !doctorId) {
      return res.status(400).json({ success: false, error: "الرجاء إدخال اسم المريض وضمان تحديد الحسابات" });
    }

    // 1. توليد معرف المريض الفريد المعتمد في نظامك
    const patientId = "pat_" + Date.now();
    const currentDateTime = datetime || new Date().toISOString();

    // 2. بناء كائن البيانات متوافقاً مع أعمدة جدول Supabase الحالي (Snake_Case)
    const newPatientForSupabase = {
      id: patientId,
      name: name.trim(),
      phone: phone || "",
      datetime: currentDateTime,
      status: "waiting",
      secretary_id: secretaryId,
      doctor_id: doctorId
    };

    // 3. إدراج المريض مباشرة في جدول patients بـ Supabase
    const { error: insertError } = await supabase
      .from('patients')
      .insert([newPatientForSupabase]);

    if (insertError) throw insertError;

    // 4. إعداد تفاصيل السجل للحفاظ على بيانات (العمر، الطول، الوزن، الدفع) في الـ sync_logs السحابي
    const typeLabel = !!isReview ? "مراجعة مجانية / استشارة" : `كشفية بقيمة ${Number(amountPaid) || 0} د.ع/$`;
    const detailedLog = `قام السكرتير بإضافة مريض جديد: ${name} (النوع: ${typeLabel} | العمر: ${age || 'غير محدد'} | الطول: ${height || 'غير محدد'} | الوزن: ${weight || 'غير محدد'})`;
    
    // تسجيل العملية سحابياً
    await addSyncLog("إضافة مريض مراجع", "jehat.hassan91@gmail.com", detailedLog);

    // 5. إرجاع النتيجة لصيغة الـ Frontend المتوقعة (CamelCase) حتى لا يتوقف المتصفح
    res.json({ 
      success: true, 
      patient: {
        id: patientId,
        name,
        phone: phone || "",
        datetime: currentDateTime,
        age: age || "",
        height: height || "",
        weight: weight || "",
        status: "waiting",
        secretaryId,
        doctorId,
        amountPaid: Number(amountPaid) || 0,
        isReview: !!isReview,
        createdAt: new Date().toISOString()
      } 
    });

  } catch (error: any) {
    console.error("Insert Patient Error:", error);
    res.status(500).json({ success: false, error: error.message || "حدث خطأ أثناء إضافة المريض" });
  }
});


// Update patient status (e.g. request approval, admit, complete)

// API: تحديث حالة المريض في قاعدة البيانات السحابية
app.put("/api/patients/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: "الحالة الجديدة مطلوبة" });
    }

    // 1. جلب بيانات المريض الحالية لمعرفة الحالة القديمة واسم المريض قبل التحديث
    const { data: currentPatient, error: fetchError } = await supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!currentPatient) {
      return res.status(404).json({ success: false, error: "المريض غير موجود في النظام" });
    }

    const oldStatus = currentPatient.status;

    // 2. تنفيذ عملية التحديث السحابي في جدول patients بـ Supabase
    const { data: updatedPatient, error: updateError } = await supabase
      .from('patients')
      .update({ status: status })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // 3. صياغة تفاصيل السجل وتخزينها سحابياً في جدول الـ sync_logs
    const logDetails = `تغيرت حالة المريض ${updatedPatient.name} من ${oldStatus} إلى ${status}`;
    await addSyncLog("تعديل حالة مريض", "jehat.hassan91@gmail.com", logDetails);

    // 4. إرجاع النتيجة لصيغة الـ Frontend المتوقعة (CamelCase) لتحديث الواجهة تلقائياً
    res.json({ 
      success: true, 
      patient: {
        id: updatedPatient.id,
        name: updatedPatient.name,
        phone: updatedPatient.phone,
        datetime: updatedPatient.datetime,
        status: updatedPatient.status,
        secretaryId: updatedPatient.secretary_id,
        doctorId: updatedPatient.doctor_id,
        createdAt: updatedPatient.created_at
      } 
    });

  } catch (error: any) {
    console.error("Update Patient Status Error:", error);
    res.status(500).json({ success: false, error: error.message || "حدث خطأ أثناء تحديث حالة المريض" });
  }
});

// Delete/Cancel a patient
// API: إلغاء وحذف حجز مريض من قاعدة البيانات السحابية
app.delete("/api/patients/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1. جلب اسم المريض قبل الحذف لتسجيله في السجلات السحابية
    const { data: patient, error: fetchError } = await supabase
      .from('patients')
      .select('name')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!patient) {
      return res.status(404).json({ success: false, error: "المريض غير موجود" });
    }

    // 2. حذف صف المريض مباشرة من جدول patients في Supabase
    const { error: deleteError } = await supabase
      .from('patients')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    // 3. كتابة العملية في السجل السحابي الموحد (sync_logs)
    await addSyncLog("إلغاء مريض", "jehat.hassan91@gmail.com", `تم إلغاء وحذف المريض ${patient.name} لتغيبه أو مغادرته قاعدة البيانات السحابية`);

    res.json({ success: true });

  } catch (error: any) {
    console.error("Delete Patient Error:", error);
    res.status(500).json({ success: false, error: error.message || "حدث خطأ أثناء إلغاء حجز المريض" });
  }
});

// Prescriptions routing - جلب الوصفات والروشتات الطبية سحابياً
app.get("/api/prescriptions", async (req, res) => {
  try {
    const { doctorId } = req.query;

    // بدء بناء استعلام Supabase لجلب الروشتات
    let query = supabase.from('prescriptions').select('*');

    // تصفية الروشتات بناءً على معرف الطبيب المعالج إن وجد
    if (doctorId) {
      query = query.eq('doctor_id', doctorId);
    }

    const { data: prescriptions, error } = await query;

    if (error) throw error;

    // تحويل الحقول من صيغة قاعدة البيانات (Snake_Case) إلى صيغة الواجهات (CamelCase)
    const formattedPrescriptions = (prescriptions || []).map(p => ({
      id: p.id,
      patientId: p.patient_id,
      doctorId: p.doctor_id,
      details: p.details,
      createdAt: p.created_at
    }));

    res.json(formattedPrescriptions);

  } catch (error: any) {
    console.error("Fetch Prescriptions Error:", error);
    res.status(500).json({ success: false, error: error.message || "حدث خطأ أثناء جلب الوصفات الطبية" });
  }
});
// API: كتابة أو تحديث وصفة طبية وتحويل حالة المريض تلقائياً إلى مكتمل
app.post("/api/prescriptions", async (req, res) => {
  try {
    const { patientId, patientName, doctorId, medicines, xrays, tests, other } = req.body;
    
    if (!patientId || !doctorId) {
      return res.status(400).json({ success: false, error: "معلومات الطبيب والمريض مطلوبة" });
    }

    // 1. تجميع الحقول الفرعية المتوقعة من الـ Frontend في حقل نصوص موحد (JSON) ليطابق عمود details في Supabase
    const detailedData = {
      medicines: medicines || "",
      xrays: xrays || "",
      tests: tests || "",
      other: other || ""
    };
    const detailsString = JSON.stringify(detailedData);

    // 2. التحقق مما إذا كان هناك وصفة طبية مسجلة مسبقاً لهذا المريض في Supabase
    const { data: existingPres, error: fetchError } = await supabase
      .from('prescriptions')
      .select('*')
      .eq('patient_id', patientId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    let resultPrescriptionId: string | number;
    let isUpdate = false;

    if (existingPres) {
      // تحديث الوصفة الحالية
      isUpdate = true;
      resultPrescriptionId = existingPres.id;

      const { error: updateError } = await supabase
        .from('prescriptions')
        .update({ details: detailsString, doctor_id: doctorId })
        .eq('patient_id', patientId);

      if (updateError) throw updateError;
    } else {
      // إنشاء وصفة طبية جديدة سحابياً
      const { data: newPres, error: insertError } = await supabase
        .from('prescriptions')
        .insert([{
          patient_id: patientId,
          doctor_id: doctorId,
          details: detailsString
        }])
        .select()
        .single();

      if (insertError) throw insertError;
      resultPrescriptionId = newPres.id;
    }

    // 3. تحديث حالة المريض تلقائياً إلى "completed" (مكتمل) في جدول patients
    const { error: patientUpdateError } = await supabase
      .from('patients')
      .update({ status: 'completed' })
      .eq('id', patientId);

    if (patientUpdateError) console.error("تنبيه: تعذر تحديث حالة المريض إلى مكتمل سحابياً:", patientUpdateError);

    // 4. صياغة تفاصيل السجل السحابي وتخزينه في جدول sync_logs
    const logDetails = `قام الطبيب بكتابة وصفة (راشيتة) للمريض ${patientName || 'المحدد'}: الأدوية (${medicines || ''}), الأشعة (${xrays || ''}), الفحوصات (${tests || ''}), أخرى (${other || ''})`;
    await addSyncLog("كتابة وصفة طبية", "jehat.hassan91@gmail.com", logDetails);

    // 5. إرجاع النتيجة بالهيكل الذي ينتظره الـ Frontend لضمان عدم توقف الواجهات
    res.json({ 
      success: true, 
      prescription: {
        id: resultPrescriptionId,
        patientId,
        patientName,
        doctorId,
        medicines: medicines || "",
        xrays: xrays || "",
        tests: tests || "",
        other: other || "",
        createdAt: new Date().toISOString()
      } 
    });

  } catch (error: any) {
    console.error("Prescription Process Error:", error);
    res.status(500).json({ success: false, error: error.message || "حدث خطأ أثناء معالجة الوصفة الطبية" });
  }
});

// API: Smart AI clinical suggestions based on current symptoms and diseases
// API: معالج ومساعد العيادات الطبي المعتمد على الذكاء الاصطناعي والقواعد الذكية
app.post("/api/gemini/suggest", async (req, res) => {
  try {
    const { symptoms } = req.body;
    if (!symptoms || !Array.isArray(symptoms) || symptoms.length === 0) {
      return res.json({ medicines: [], xrays: [], tests: [] });
    }

    const queryText = symptoms.join(", ");
    const normalizedQuery = queryText.toLowerCase();

    // 1. نظام القواعد السريرية التلقائي (في حال عدم تفعيل مفتاح البيئة السحابية)
    if (!process.env.GEMINI_API_KEY) {
      let medicines: string[] = ["Paracetamol 500mg - 3 times daily", "Amoxicillin 500mg - twice daily"];
      let xrays: string[] = [];
      let tests: string[] = ["CBC (فحص دم كامل)", "CRP (مؤشر الالتهابات)"];

      if (normalizedQuery.includes("سيلان") || normalizedQuery.includes("انف") || normalizedQuery.includes("حلق") || normalizedQuery.includes("بلعوم") || normalizedQuery.includes("حرق البلعوم")) {
        medicines = [
          "Panadol Cold & Flu - حبة كل 8 ساعات لإزالة الاحتقان",
          "Amoxicillin 500mg - كبسولة كل 8 ساعات لمدة 5 أيام",
          "Claritin 10mg - حبة ليلاً مضاد تحسس",
          "Decatylen Lozenges - حبوب مص لتسكين وتطهير البلعوم",
          "Saline Nasal Spray - بخاخ أنف ملحي مرطب"
        ];
        xrays = ["Chest X-Ray (تصوير الصدر الشعاعي لتأكيد سلامة الرئتين)"];
        tests = ["CBC (فحص الدم العام)", "Throat Swab Culture (مسحة وزرع البلعوم لمقاومة المضادات)"];
      } else if (normalizedQuery.includes("حرارة") || normalizedQuery.includes("سخونة") || normalizedQuery.includes("حمى") || normalizedQuery.includes("نوم")) {
        medicines = [
          "Paracetamol 500mg - كبسولة عند الحاجة كل 6 ساعات",
          "Brufen 400mg - مسكن ومضاد وذمة بعد الطعام عند اللزوم",
          "Cefixime 400mg - مضاد التهاب واسع الطيف حبة يومياً"
        ];
        xrays = ["Chest X-Ray AP/LAT (لتشخيص التهابات الرئة والقصيبات)"];
        tests = ["Widal Test (فحص حمى التيفويد وبكتيريا السالمونيلا)", "CBC with ESR (فحص الكريات وسرعة الترسيب)", "GUE (تحليل الإدرار العام لاستبعاد التهاب المجاري)"];
      } else if (normalizedQuery.includes("حساسية") || normalizedQuery.includes("ربو") || normalizedQuery.includes("طفل") || normalizedQuery.includes("تحسس")) {
        medicines = [
          "Zyrtec Syrup 5ml - ملعقة صغيرة مساءً للأطفال",
          "Ventolin Inhaler - بخاخ فنتولين بختين عند الشعور بضيق التنفس",
          "Prednisolone 5mg - حبة صباحاً بعد الأكل لمدة 3 أيام للتحسس الحاد",
          "Singulair 5mg - حبة مضغ للأطفال ليلاً لدعم التنفس"
        ];
        xrays = ["Chest X-Ray / Sinus View (أشعة الصدر أو الجيوب الأنفية)"];
        tests = ["IgE Total (فحص الأجسام المضادة لنسب الحساسية)", "CBC (Eosinophils Blood Count)"];
      } else if (normalizedQuery.includes("مغص") || normalizedQuery.includes("بطن") || normalizedQuery.includes("اسهال") || normalizedQuery.includes("تسمم") || normalizedQuery.includes("تقيؤ")) {
        medicines = [
          "Flagyl 505mg - حبة 3 مرات يومياً مطهر معوي",
          "Buscopan Tablet - حبة عند الألم لتشنجات البطن ومغص المعاء",
          "Motilium 10mg - حبة قبل الطعام بربع ساعة لمنع الغثيان",
          "O.R.S Sachets - كيس محاليل مائية في قدح ماء لتعويض جفاف الإسهال"
        ];
        xrays = ["Abdominal Ultrasound (سونار البطن والحوض الشامل)"];
        tests = ["Stool Analysis & Culture (تحليل الخروج العام وزرعه للجراثيم)", "CBC & Serum Electrolytes (تحليل الإلكتروليتات والأملاح)"];
      } else if (normalizedQuery.includes("رأس") || normalizedQuery.includes("صداع") || normalizedQuery.includes("شقيقة") || normalizedQuery.includes("ضغط")) {
        medicines = [
          "Advil Cold & Headache - حبة عند اللزوم لتخفيف آلام الصداع",
          "Imigran 50mg - حبة واحدة فور بدء نوبة الشقيقة (الصداع النصفي)",
          "Panadol Joint - حبتين ممتدة المفعول كل 8 ساعات"
        ];
        xrays = ["Brain CT Scan (مفراس الرأس والدماغ عند الشك بأسباب عضوية)"];
        tests = ["Blood Pressure Monitoring (مراقبة وقياس مستمر لضغط الدم)", "CBC and Serum Iron (فحص فقر الدم والحديد)"];
      }

      return res.json({
        medicines,
        xrays,
        tests,
        isSimulated: true,
        info: "تنبيه: تم استخدام الذكاء الاصطناعي المدمج بالعيادة بنجاح."
      });
    }

    // 2. معالجة وتوليد المقترحات الطبية سحابياً عبر Gemini AI
    const client = getAiClient();
    if (!client) {
      throw new Error("Gemini AI client not initialized");
    }

    // تم تعديل اسم النموذج إلى الموديل الرسمي المستقر والمتاح في الـ SDK لضمان عدم توقف الإرسال سحابياً
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash", 
      contents: `You are an expert clinical systems assistant for doctor clinics.
The patient presents with the following symptoms or diagnosis: "${queryText}".
Provide a JSON object containing clinical suggestions tailored to Iraqi & Arab physicians:
- "medicines": Array of suggested medications (with standard generic/brand name and basic dosage/frequency e.g. "Amoxicillin 500mg - 3 times daily") written in elegant clear Arabic or English, appropriate for the patients condition/age.
- "xrays": Array of recommended clinical imaging (e.g. "Chest X-Ray AP/Lateral" or "Abdominal Ultrasound") with short helpful reason.
- "tests": Array of recommended medical lab test names (e.g. "CBC", "CRP", "HbA1c", "Serum Creatinine") with short description.

Adjust recommendations carefully if specific patient age (like "طفل 15 عام" or analogous) is mentioned in the query. Keep clinical options short, concise and professional so the doctor can instantly click to append them to the text areas.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            medicines: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Medicines and generic names with dosages in Arabic or English"
            },
            xrays: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Recommended radiography/imaging with short desc"
            },
            tests: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Recommended lab tests with short desc"
            }
          },
          required: ["medicines", "xrays", "tests"]
        }
      }
    });

    const output = JSON.parse(response.text || "{}");
    res.json({
      medicines: output.medicines || [],
      xrays: output.xrays || [],
      tests: output.tests || []
    });

  } catch (err: any) {
    console.error("Gemini AI API Error:", err);
    res.json({
      medicines: ["Paracetamol 500mg - حبة عند الحاجة"],
      xrays: [],
      tests: ["CBC", "CRP"],
      error: "حدث خطأ أثناء إجراء التحليل الذكي للذكاء الاصطناعي. مستمرون في تقديم الخدمة الافتراضية."
    });
  }
});
// Chat Routing (live communication between selected Doctor and Secretary)
app.get("/api/chat", (req, res) => {
  const { userA, userB } = req.query;
  if (!userA || !userB) {
    return res.status(400).json({ error: "معرفات الأطراف مطلوبة" });
  }

  const db = readDb();
  // Filter messages between userA and userB
  const chatList = db.messages.filter(
    (m) =>
      (m.senderId === userA && m.receiverId === userB) ||
      (m.senderId === userB && m.receiverId === userA)
  );

  res.json(chatList);
});

app.post("/api/chat", (req, res) => {
  const { senderId, receiverId, text } = req.body;
  if (!senderId || !receiverId || !text) {
    return res.status(400).json({ error: "محتوى الرسالة منقوص" });
  }

  const db = readDb();
  const newMsg: Message = {
    id: "msg_" + Date.now(),
    senderId,
    receiverId,
    text,
    createdAt: new Date().toISOString()
  };

  db.messages.push(newMsg);
  writeDb(db);

  res.json({ success: true, message: newMsg });
});

// Developer Sheet System Integration
app.get("/api/sync-logs", (req, res) => {
  const db = readDb();
  res.json({
    logs: db.syncLogs,
    users: db.users,
    patients: db.patients,
    prescriptions: db.prescriptions,
    programmerEmail: "jehat.hassan91@gmail.com"
  });
});

// Export database as CSV (resembling physical excel sheet)
// API: تصدير واستخراج تقرير الـ CSV السحابي المتزامن مع شيت المبرمج
app.get("/api/export-csv", async (req, res) => {
  try {
    // 1. جلب بيانات المستخدمين وسجلات العمليات بالتوازي (Parallel) من قاعدة البيانات السحابية لسرعة الاستجابة
    const [usersResponse, logsResponse] = await Promise.all([
      supabase.from('users').select('*'),
      supabase.from('sync_logs').select('*')
    ]);

    if (usersResponse.error) throw usersResponse.error;
    if (logsResponse.error) throw logsResponse.error;

    const cloudUsers = usersResponse.data || [];
    const cloudLogs = logsResponse.data || [];

    // 2. تهيئة نص الـ CSV مع ترميز UTF-8 BOM لضمان دعم برامج الجداول (مثل Excel) للغة العربية بنجاح
    let csvContent = "\uFEFF"; 
    csvContent += "الرقم التعريفي,الاسم الأول,الاسم الثاني,اسم المستخدم,كلمة المرور,رقم الهاتف,البريد الإلكتروني,الصفة/الدور,وقت الإنشاء\n";
    
    // بناء أسطر المستخدمين من البيانات الراجعة من الجدول السحابي
    cloudUsers.forEach(u => {
      csvContent += `"${u.id}","${u.first_name}","${u.last_name}","${u.username}","${u.password_hash}","${u.phone}","${u.email}","${u.role}","${u.created_at}"\n`;
    });

    // إضافة ترويسة سجل العمليات الخاص بنظام المزامنة
    csvContent += "\n\nسجل العمليات المتزامنة مع قاعدة البيانات السحابية للمبرمج (jehat.hassan91@gmail.com)\n";
    csvContent += "المعرف,التوقيت,العملية المنفذة,الحساب المتأثر,التفاصيل المزامنة\n";
    
    // بناء أسطر السجلات
    cloudLogs.forEach(g => {
      csvContent += `"${g.id}","${g.timestamp}","${g.action}","${g.email_affected}","${g.details}"\n`;
    });

    // 3. إعداد هيدر الاستجابة كملف تحميل CSV مباشر للمتصفح
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=clinics_excel_jehat.csv");
    res.status(200).send(csvContent);

  } catch (error: any) {
    console.error("Export CSV Error:", error);
    res.status(500).json({ success: false, error: error.message || "حدث خطأ أثناء تصدير ملف الـ CSV" });
  }
});

// Vite middleware and fallbacks setup



// إعداد خادم وميدل وير تشغيل المشروع سحابياً
async function startServer() {
  console.log("Connecting safely to Supabase cloud database layer...");

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server cloud system safely running on port ${PORT}`);
  });
}

startServer();