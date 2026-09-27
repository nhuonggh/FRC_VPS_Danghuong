# Registry chung: GC hằng tuần làm hỏng tag image (ghi nhận 2026-09-27)

Tài liệu này chỉ **ghi nhận và đề xuất** cho chủ registry (`registry.francophiles.com.vn`, container `registry`). Dự án DHERP
**không sửa** registry, crontab hay dự án nào khác; mọi mục "Đề xuất" bên dưới do chủ registry tự quyết định và tự áp dụng.

## Hiện tượng

- `docker pull` image mới đẩy lên báo `manifest unknown` hoặc `blob ... EOF`.
- Tag `crm:latest`, `crm:migrate`, `lms:latest` trong registry là OCI index nhưng các manifest con trả **404** → **không pull được**
  (kiểm tra chỉ đọc 2026-09-27). Container `crm_app`/`lms_app` vẫn chạy vì image còn local trên VPS.
- Repo `crm`/`lms` còn hàng nghìn liên kết layer mồ côi trong `_layers` (blob đã bị xoá).

## Nguyên nhân

Crontab của root có dòng:

    0 3 * * 0 docker exec registry bin/registry garbage-collect --delete-untagged /etc/docker/registry/config.yml >> /var/log/registry-gc.log 2>&1

Chạy Chủ nhật 03:00 giờ VPS (CEST = 01:00 UTC). Image build bằng buildx mặc định là **OCI index** (manifest amd64 + manifest
attestation/provenance). Registry 2.8 với `--delete-untagged` coi các manifest con của index là "chưa gắn tag" nên xoá chúng
(log `/var/log/registry-gc.log`, lần chạy 2026-09-27: "manifest eligible for deletion" cho các manifest con của `crm`) và xoá
luôn blob layer. Link `_layers` bị bỏ lại nên các lần push sau tưởng blob còn và bỏ qua upload.

Ngoài ra có 2 lần GC thủ công 2026-09-26 (01:35 và 01:38 giờ VPS, không kèm `--delete-untagged`) — ít khả năng là nguyên nhân chính.

## DHERP đã tự bảo vệ (không ảnh hưởng dự án khác)

- Build với `provenance: false` và `sbom: false` → mỗi tag là **một manifest đơn**, không có manifest con để GC xoá.
- Workflow `deploy.yml` có bước chờ, không push/pull trong cửa sổ Chủ nhật 02:45–03:15 giờ VPS.
- Xử lý khi vẫn gặp lỗi với repo `dherp`: xoá đúng thư mục repo `dherp` trong storage registry rồi chạy lại workflow
  (RUNBOOK mục 3). Không đụng repo khác.

## Đề xuất cho chủ registry (chưa áp dụng)

Chọn 1 trong 2 (hoặc cả hai):

1. **Bỏ `--delete-untagged` khỏi cron** (an toàn nhất; chỉ mất khả năng dọn manifest mồ côi):

       0 3 * * 0 docker exec registry bin/registry garbage-collect /etc/docker/registry/config.yml >> /var/log/registry-gc.log 2>&1

   Có thể chạy thử trước bằng `garbage-collect --dry-run`.

2. **Thêm `provenance: false` và `sbom: false`** vào 2 bước `docker/build-push-action@v6` trong workflow `crm` và `lms`
   (mỗi bước thêm 2 dòng dưới `push: true`), rồi deploy lại để đẩy lại `:latest` và `:migrate`. Image đã đẩy lên trước đó (index
   có manifest con bị xoá) cần được push lại mới pull được.

Sau khi áp dụng, kiểm tra tag còn nguyên bằng cách tải manifest con của từng tag (`GET /v2/<repo>/manifests/<digest-con>` phải 200).
