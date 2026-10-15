/**
 * API công khai của module BOM (plan 03c). Module nghiệp vụ khác (bán hàng, sản xuất) CHỈ import từ đây.
 * `resolveBom` là hàm đọc thuần: plan 04+ phải lưu `versionId` vào dòng chứng từ khi dùng, KHÔNG truy vấn động lại cho đơn cũ (D-20).
 */
export { BomNotFoundError, resolveBom, type BomSnapshot } from "./resolve";
export { cancelBomVersion, createBomVersion, createBomVersionIdempotent } from "./service";
export { getBom, listBoms, type BomDetailDTO, type BomListRow, type BomVersionDTO } from "./queries";
export { BOM_MATERIAL_KINDS, BOM_TARGET_KINDS, createBomVersionSchema, type CreateBomVersionInput } from "./schemas";
