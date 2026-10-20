-- Phiếu thu "Bổ sung quỹ": tiền giám đốc đưa thêm vào quỹ tiền mặt trong ngày (không gắn khách, không công nợ).
ALTER TYPE "receipt_type" ADD VALUE IF NOT EXISTS 'BO_SUNG_QUY';
