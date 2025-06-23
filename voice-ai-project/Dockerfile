# ใช้ Python 3.11
FROM python:3.11

# ตั้ง working directory
WORKDIR /app/frontend

# ติดตั้ง MySQL Client
RUN apt update && apt install -y default-mysql-client
# ติดตั้ง FFmpeg
RUN apt-get update && apt-get install -y ffmpeg
# คัดลอกไฟล์ requirements.txt และติดตั้ง dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt 

# คัดลอกโปรเจกต์ทั้งหมด
COPY . .

# ตั้งค่า PYTHONPATH ให้ Django หา RVC_DJ ได้
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH="/app/frontend"

# เปิดพอร์ต 8000
EXPOSE 8000

# ✅ รันคำสั่งให้ Django อัปเดตฐานข้อมูลอัตโนมัติ
CMD ["sh", "-c", "until mysqladmin ping -h db --silent; do sleep 5; done && python manage.py makemigrations && python manage.py migrate && python manage.py collectstatic --noinput && python manage.py runserver 0.0.0.0:8000"]
