# Vachana-Cloning: แพลตฟอร์มแปลภาษาและโคลนนิ่งเสียงด้วย AI แบบเรียลไทม์
# Vachana-Cloning: Real-Time Translation and AI Voice Cloning Platform

Vachana-Cloning คือแพลตฟอร์มสื่อสารแบบเรียลไทม์ที่ใช้ประโยชน์จากเทคโนโลยีปัญญาประดิษฐ์ (AI) เพื่อทำลายกำแพงด้านภาษา โปรเจกต์นี้ได้ผสานเทคโนโลยีการแปลงเสียงเป็นข้อความ (Speech-to-Text - STT), การแปลภาษา (Machine Translation - MT), และการแปลงข้อความเป็นเสียงพูด (Text-to-Speech - TTS) เข้ากับความสามารถในการโคลนเสียง เพื่อมอบประสบการณ์การสนทนาข้ามภาษาที่ราบรื่นและเป็นธรรมชาติ

Vachana-Cloning is a real-time communication platform that leverages the power of Artificial Intelligence (AI) to break down language barriers. This project integrates Speech-to-Text (STT), Machine Translation (MT), and Text-to-Speech (TTS) with voice cloning capabilities to offer a seamless and natural multilingual conversation experience.

---

## คุณสมบัติหลัก / Core Features

* **การสื่อสารด้วยเสียงแบบเรียลไทม์ / Real-Time Voice Communication**: สนทนาได้อย่างราบรื่นผ่านการสื่อสารแบบเรียลไทม์ที่ออกแบบมาให้มีดีเลย์น้อยที่สุด
* **รองรับหลายภาษา / Multi-Language Support**: ปัจจุบันแพลตฟอร์มรองรับ 4 ภาษา ได้แก่ ไทย, อังกฤษ, ญี่ปุ่น และจีน
* **การโคลนเสียงด้วย AI / AI-Powered Voice Cloning**: ระบบสามารถโคลนเสียงของผู้พูด โดยรักษาน้ำเสียงและอารมณ์ของต้นฉบับไว้ในเสียงที่แปลออกมา เพื่อให้การสื่อสารมีความเป็นธรรมชาติมากที่สุด
* **คุณภาพสูงและดีเลย์ต่ำ / High-Quality, Low-Latency Performance**: ออกแบบมาให้มีค่าความหน่วง (Latency) ต่ำกว่า 2 วินาที เพื่อให้การสื่อสารเป็นไปอย่างต่อเนื่องและมีประสิทธิภาพ
* **หน้าจอใช้งานง่าย / User-Friendly Interface**: ออกแบบ UX/UI ให้สวยงามและใช้งานง่าย
* **ห้องสนทนาหลายผู้ใช้ / Multi-User Rooms**: แต่ละห้องสนทนารองรับผู้ใช้งานพร้อมกันได้สูงสุด 8 คน

---

## เทคโนโลยีที่ใช้ / Technology Stack

โปรเจกต์นี้ถูกสร้างขึ้นด้วยเทคโนโลยีที่มีประสิทธิภาพและสามารถขยายระบบได้ในอนาคต:

This project is built with a robust and scalable technology stack:

* **Frontend**: HTML, CSS
* **Backend**: Python, Django, FastAPI, WebSocket, WebRTC
* **AI & Machine Learning**:
    * **Speech-to-Text (STT)**: OpenAI's Whisper
    * **Machine Translation (MT)**: Meta's M2M-100
    * **Text-to-Speech & Voice Cloning (TTS)**: OpenXTTS-V2
    * **ML Framework**: PyTorch
* **Database**: MySQL
* **Deployment**: Docker

---

## สถาปัตยกรรมและการทำงานของระบบ / System Architecture and How It Works

สถาปัตยกรรมของแพลตฟอร์มประกอบด้วย 4 โมดูลหลักที่ทำงานร่วมกัน:
The platform's architecture is composed of four primary modules working in tandem:

1.  **Speech-to-Text (STT)**: รับเสียงพูดของผู้ใช้และแปลงเป็นข้อความ
2.  **Machine Translation (MT)**: แปลข้อความที่ได้เป็นภาษาเป้าหมาย
3.  **Text-to-Speech (TTS) & Voice Cloning**: สังเคราะห์ข้อความที่แปลแล้วให้กลายเป็นเสียงพูดที่เลียนแบบเสียงต้นฉบับ
4.  **Backend API & Real-Time Communication**: จัดการการส่งข้อมูลและการสื่อสารแบบเรียลไทม์ระหว่างผู้ใช้ผ่าน WebRTC และ WebSocket

**ขั้นตอนการทำงาน / How It Works**
![Flowchart](https://i.imgur.com/vHblY2k.png)

1.  **ผู้ใช้ A (User A)** พูดภาษาของตนเอง
2.  เสียงจะถูกส่งไปยังเซิร์ฟเวอร์
3.  เซิร์ฟเวอร์ใช้ **STT** เพื่อแปลงเสียงเป็นข้อความ
4.  ข้อความจะถูกแปลเป็นภาษาที่ **ผู้ใช้ B (User B)** เลือกไว้ด้วย **MT**
5.  ข้อความที่แปลแล้วจะถูกสังเคราะห์เป็นเสียงโคลนนิ่งด้วย **TTS**
6.  เสียงที่ได้จะถูกส่งไปยัง **ผู้ใช้ B**

---

## การติดตั้งและใช้งาน / Getting Started

ทำตามขั้นตอนง่ายๆ ด้านล่างนี้เพื่อติดตั้งโปรเจกต์และรันบนเครื่องของคุณ

To get a local copy up and running, follow these simple steps.

### สิ่งที่ต้องมี / Prerequisites

* Docker
* Git

### การติดตั้ง / Installation

1.  คัดลอกโปรเจกต์ (Clone the repo)
    ```sh
    git clone [https://github.com/Akira-Chaiyachet/Vachana-Cloning.git](https://github.com/Akira-Chaiyachet/Vachana-Cloning.git)
    ```
2.  เข้าไปยังโฟลเดอร์ของโปรเจกต์ (Navigate to the project directory)
    ```sh
    cd Vachana-Cloning
    ```
3.  สร้างและรัน Docker containers (Build and run the Docker containers)
    ```sh
    docker-compose up --build
    ```
4.  เปิดเบราว์เซอร์และไปที่ `http://localhost:8000` (Open your browser and navigate to `http://localhost:8000`)

---

## ผู้จัดทำ / Contributors

โปรเจกต์นี้พัฒนาโดย:
This project was developed by:

* **ธีระพงษ์ แก้วหยาด / Thiraphong Kaewyart**
* **อคิราห์ ไชยเชษฐ์ / Akira Chaiyachet**

โครงการนี้เป็นส่วนหนึ่งของการศึกษาตามหลักสูตรสาขาวิชาวิศวกรรมคอมพิวเตอร์และอิเล็กทรอนิกส์ คณะอุตสาหกรรม มหาวิทยาลัยเทคโนโลยีราชมงคลอีสาน
A project for the Computer and Electronics Engineering program, Faculty of Industry, Rajamangala University of Technology Isan.
