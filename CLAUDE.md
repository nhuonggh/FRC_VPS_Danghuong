# DH_Crm — hướng dẫn cho AI

**Đọc `docs/STATUS.md` ĐẦU TIÊN** (trạng thái, việc đã xong / đang làm / sẽ làm / chờ user duyệt, hạ tầng thật, quy tắc bất di bất dịch).

Ba quy tắc quan trọng nhất (chi tiết ở STATUS.md mục 2):
- Push/merge `main` = deploy lên VPS đang chạy dự án thật → hỏi user trước. VPS có dự án khác (crm, lms, bldemo, WordPress…): chỉ đọc, không sửa nếu user chưa cho phép rõ ràng.
- Không commit secret. Không chạy 2 vitest cùng lúc (DB test cổng 5434). Windows + Git Bash: dùng `rtk proxy npx vitest run …`.
- Engine FIFO: chỉ gọi qua `src/server/inventory/index.ts`; sửa engine chứ không sửa oracle `tests/inventory/reference.ts`. UI theo skill `crm-design`, deploy theo skill `setup-project`.

Sau khi làm xong việc: cập nhật `docs/STATUS.md` cùng commit. Giao tiếp với user bằng tiếng Việt, ngắn gọn.
