-- Phiếu chi "Nộp lại quỹ": giám đốc nhận lại tiền quỹ (không gắn đối tác, không công nợ, không tính vào chi phí).
ALTER TYPE "payment_kind" ADD VALUE IF NOT EXISTS 'NOP_LAI_QUY';
