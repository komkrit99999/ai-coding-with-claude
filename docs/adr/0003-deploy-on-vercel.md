---
status: accepted
---

# deploy บน Vercel ด้วย Build Output API และใช้ `x-vercel-forwarded-for` เป็น client key เฉพาะบน Vercel

ใช้ demo นี้ในห้องเรียนผ่าน URL สาธารณะบน Vercel ที่เปิดรับรายงานเฉพาะช่วงสอน มีเรื่องที่ต้องตัดสินใจสามเรื่อง

**ระบุ client จากอะไร:** บน Vercel `req.socket.remoteAddress` เป็น proxy ของ Vercel ไม่ใช่ของผู้ใช้ ถ้ายังทำตาม RPT-REQ-009 เดิม (ใช้ socket address อย่างเดียว) ทุกคนจะได้ key เดียวกัน และทั้งห้องได้รวมกันแค่ 5 รายงานต่อชั่วโมง บน Vercel จึงใช้ `x-vercel-forwarded-for` แทน เพราะ [Vercel เขียนทับ header นี้](https://vercel.com/docs/headers/request-headers) ด้วย IP จริงทุกครั้ง ผู้ใช้จึงปลอมไม่ได้ ที่อื่นยังใช้ socket address อย่างเดียวเหมือนเดิม เพราะนอก Vercel ใครจะส่ง header นี้มาก็ได้ การรวม IPv6 เป็น /64 และข้อห้ามเก็บหรือ log key ยังเหมือนเดิม entry ของ Vercel (`src/vercel.ts`) ประกาศเองว่ากำลังรันบน Vercel ไม่ได้อ่านจากตัวแปร

**build อย่างไร:** builder ของ Vercel พังเมื่อเจอ TypeScript 7 ของ repo เพราะไปเรียก `ts.sys.readFile` ซึ่ง TypeScript 7 (เขียนใหม่ด้วย Go) ไม่มีแล้ว และ Vercel ยังเลือก `src/app.ts` ที่ไม่มี server มาเป็นไฟล์เริ่มต้น เราจึงให้ `npm run build:vercel` เขียน `.vercel/output` ([Build Output API](https://vercel.com/docs/build-output-api)) เอง esbuild รวมโค้ดเป็น JS ไฟล์เดียว Vercel จึงไม่ต้อง type check เอง และ repo ยังใช้ TypeScript 7 กับ `npm run lint` ได้เหมือนเดิม

**ส่งไฟล์หน้าเว็บอย่างไร:** ให้ CDN ของ Vercel ส่งไฟล์หน้าเว็บ ส่วนทางอื่นทั้งหมดส่งไปที่ function ตัวเดียว ไฟล์ที่ copy เข้า CDN มาจากรายการตายตัวใน `src/static.ts` เท่านั้น และ header ของแต่ละไฟล์ (CSP, cache, `nosniff`, `noindex`) ก็มาจาก `fileHeaders()` ตัวเดียวกัน หน้าเว็บบน Vercel จึงได้ header เหมือนตอนรัน `npm start` ไฟล์ tiles ขนาด 46 MB ก็ส่งผ่าน CDN ซึ่งรองรับ byte range

## Considered Options

- **ใช้ socket address ต่อไปบน Vercel:** ทั้งห้องได้โควตาเดียวกัน ใช้สอนไม่ได้ ไม่เลือก
- **อ่าน `X-Forwarded-For` ทุกที่:** นอก Vercel ปลอมได้ ทำให้ RPT-REQ-009 AC3 ไม่เป็นจริง ไม่เลือก
- **ให้ Vercel หา Node server เอง (zero-config):** เลือกไฟล์เริ่มต้นผิด และพังเพราะ TypeScript 7 อยู่แล้ว ไม่เลือก
- **ลด TypeScript เป็น 5.x หรือติดตั้งสองเวอร์ชัน:** ต้องเปลี่ยน toolchain ของคอร์ส และยังต้องพึ่ง Vercel เรื่อง import ที่ลงท้าย `.ts` ไม่เลือก
- **ส่งทุกอย่างผ่าน function รวมทั้ง tiles:** เปลือง function และไม่ได้ใช้ CDN ไม่เลือก
- **Upstash Redis สำหรับรายงาน:** รายงานจะไม่หาย แต่ต้องเปลี่ยน `handle()` เป็น async ทั้งชุด เกินขอบเขตของ demo ห้องเรียน ไม่เลือกในรอบนี้

## Consequences

- **รายงานและโควตาอาจหายบน Vercel:** ทั้งสองอยู่ใน memory ของ function แต่ละตัว ถ้ามีหลายตัวพร้อมกัน แต่ละตัวมีรายงานไม่เหมือนกัน และพอ function เริ่มใหม่ ข้อมูลจะหายหมด โควตาจึงหลวมกว่า 5 ต่อชั่วโมงอยู่บ้าง ยอมรับได้สำหรับ demo ที่เปิดรับรายงานเฉพาะช่วงสอน (RPT-REQ-018) ต้องบอกนักเรียนตรงๆ ถ้าในห้องรายงานหายจนเป็นปัญหาจริง ค่อยทำ storage ถาวรเป็น feature แยก
- **บน Vercel ไม่มีการรับประกัน "ไม่ค้นหาไฟล์จากโฟลเดอร์" แล้ว:** CDN ส่งทุกไฟล์ที่ build copy ไป แต่ build copy เฉพาะไฟล์ที่อยู่ในรายการ ผลจึงเท่ากัน
- **เพิ่ม `esbuild` เป็น devDependency:** เดิมมีอยู่แล้วผ่าน `tsx` ข้อนี้ทำให้ RPT-REQ-017 AC1 เปลี่ยน
- **Node ล็อกเป็น `22.x`:** function รันบน `nodejs22.x`
- **เจ้าของ deployment ยังไม่ได้ตัดสิน:** แผน Hobby ห้ามใช้เชิงพาณิชย์ ต้องถาม CodePassion Academy ก่อนว่าใครเป็นเจ้าของ ถ้าเป็นของคอร์สให้ใช้ Pro
