# Quy ước phân quyền — không leo thang đặc quyền

Áp dụng cho mọi thao tác quản trị người dùng / nhóm quyền (`src/server/users/privilege.ts`, gọi từ `users/service.ts` và `roles/service.ts`).

## Quy tắc ("không cấp / không tác động vượt quá những gì mình đang có")

Quyền hiệu lực của một người = **HỢP** quyền của mọi nhóm họ giữ (một nguồn duy nhất: `unionPermissionCodes` trong `server/auth/actor.ts`, cùng nguồn với `loadActor`).

1. **Cấp quyền cho nhóm** (`updateRolePermissions`): mọi quyền được **thêm** (tập mới − tập cũ) phải nằm trong quyền của người thực hiện. Quyền đã có sẵn trong nhóm mà giữ nguyên thì không tính là "thêm".
2. **Gán nhóm cho người dùng** (`createUser`, `setUserRoles`): quyền của mọi nhóm được gán phải ⊆ quyền của người thực hiện. (`createRole` luôn tạo nhóm rỗng nên không có đường cấp quyền qua đây.)
3. **Tác động lên tài khoản khác** (`resetPassword`, `setLocked`, `setUserRoles`, `updateProfile`): quyền hiệu lực của tài khoản đích phải ⊆ quyền của người thực hiện — chặn việc `user.manage` cấp lại mật khẩu để chiếm tài khoản Giám đốc, hoặc gỡ/thay nhóm cao hơn mình. Tác động lên chính mình luôn hợp lệ ở tầng này (vẫn chịu bất biến bên dưới).
4. Lỗi trả **403** (`DomainError` mã `FORBIDDEN`), tiếng Việt, không ghi gì và không ghi audit (kiểm tra chạy trong cùng transaction, **trước** khi ghi và trước bất biến "còn quản trị viên").
5. **Giám đốc** giữ mọi quyền nên không bao giờ bị chặn bởi các quy tắc trên.

**Quyền mới thêm vào danh mục ở bản sau:** seed chỉ tự cấp quyền MỚI TẠO (chưa có trong bảng `permissions`) cho vai trò wildcard "*" (Giám đốc) đã tồn tại — nếu không, Giám đốc (quyền đọc từ DB) thiếu quyền đó và quy tắc 1 khiến không ai cấp được. Cấp quyền đã có sẵn **không bao giờ** được thêm lại (khách có thể đã chủ động gỡ); vai trò khác không tự nhận quyền mới.

Bất biến độc lập, vẫn áp dụng: luôn còn ≥ 1 tài khoản đang hoạt động có `user.manage` (`assertAdminRemains`, tuần tự hoá bằng advisory lock).

## GIẢ ĐỊNH CẦN KHÁCH XÁC NHẬN

Spec 6.6 ghi "khách tự chỉnh được sau" nhưng không nói ai được cấp quyền cho ai. Quy tắc trên là **mặc định an toàn do dự án chọn** (chưa được khách xác nhận). Khi hỏi khách cần chốt:
- Có cho phép người chỉ có `role.manage`/`user.manage` (không phải Giám đốc) tồn tại không? Nếu chỉ Giám đốc quản trị thì quy tắc này gần như vô hình.
- Có cần cho phép hạ quyền/gỡ quyền của nhóm cao hơn mình không (hiện chỉ ràng buộc việc **thêm** quyền; gỡ quyền của nhóm không bị chặn bởi quy tắc 1 — nhưng bị chặn nếu làm hết quản trị viên).

## Kiểm thử
`tests/users/privilege.test.ts` (dịch vụ, khẳng định dòng dữ liệu không đổi + 0 dòng audit khi bị từ chối) và mục "không leo thang đặc quyền" trong `tests/api/routes.test.ts`.
