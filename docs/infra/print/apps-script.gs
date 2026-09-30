/**
 * DHERP — nhận lệnh in từ hệ thống, tạo bản in Google Doc từ mẫu (template) và trả link.
 * Hướng dẫn từng bước: docs/infra/print/README.md.  Data contract version 1.
 *
 * Script properties (Project Settings → Script properties) — KHÔNG ghi secret vào mã nguồn:
 *   SECRET     chuỗi bí mật, GIỐNG hệt ô "Secret" khi cấu hình mẫu in trong hệ thống
 *   TEMPLATES  JSON: {"SALE_INVOICE":"<id Google Doc mẫu>","QUOTE":"<id>", ...}  (id nằm trong URL của Doc)
 *   FOLDER_ID  id thư mục Drive chứa các bản in
 *   SHARING    "PRIVATE" (mặc định: chỉ người có quyền vào thư mục xem được) hoặc "LINK" (ai có link đều xem được)
 */
function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var body = JSON.parse(e.postData.contents);
    var secret = props.getProperty('SECRET');
    if (!secret || body.secret !== secret) return out_({ ok: false, error: 'unauthorized' });
    if (body.version !== 1) return out_({ ok: false, error: 'contract version ' + body.version + ' chưa được script này hỗ trợ' });

    if (body.action === 'delete') { trash_(body.fileId); return out_({ ok: true }); }
    if (body.action !== 'create') return out_({ ok: false, error: 'action không hợp lệ' });

    var templates = JSON.parse(props.getProperty('TEMPLATES') || '{}');
    var templateId = templates[body.docType];
    if (!templateId) return out_({ ok: false, error: 'chưa khai báo mẫu Google Doc cho ' + body.docType + ' trong TEMPLATES' });

    if (body.replaceFileId) trash_(body.replaceFileId); // in lại: bỏ bản cũ vào thùng rác

    var folderId = props.getProperty('FOLDER_ID');
    var copy = DriveApp.getFileById(templateId).makeCopy(body.fileName, folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder());
    var doc = DocumentApp.openById(copy.getId());
    var values = flatten_(body);
    [doc.getBody(), doc.getHeader(), doc.getFooter()].forEach(function (part) { if (part) fillPart_(part, values, body.lines || []); });
    doc.saveAndClose();
    if (props.getProperty('SHARING') === 'LINK') copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return out_({ ok: true, fileId: copy.getId(), url: copy.getUrl(), name: copy.getName() });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function trash_(fileId) { try { if (fileId) DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* file đã bị xoá tay: bỏ qua */ } }
function esc_(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\$/g, '\\$'); }
function re_(key) { return '<<' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '>>'; }

/** Làm phẳng: doc.code, partner.name, company.name, company.bank.accountNo, template.title, totals.total … → chuỗi */
function flatten_(body) {
  var out = {};
  ['doc', 'partner', 'company', 'template', 'totals'].forEach(function (k) {
    var v = body[k]; if (!v) return;
    Object.keys(v).forEach(function (f) {
      if (v[f] && typeof v[f] === 'object') Object.keys(v[f]).forEach(function (g) { out[k + '.' + f + '.' + g] = v[f][g]; });
      else out[k + '.' + f] = v[f];
    });
  });
  out['docCode'] = body.docCode;
  return out;
}

/** Thay <<khóa>> ở phần thân; bảng có hàng chứa <<lines.xxx>> được nhân bản mỗi dòng hàng một hàng. */
function fillPart_(part, values, lines) {
  expandLineTables_(part, lines);
  Object.keys(values).forEach(function (k) { part.replaceText(re_(k), esc_(values[k])); });
  part.replaceText('<<[a-zA-Z0-9_.]+>>', ''); // placeholder không có dữ liệu ⇒ để trống
}

function expandLineTables_(part, lines) {
  var tables = part.getTables();
  for (var t = 0; t < tables.length; t++) {
    var table = tables[t];
    for (var r = 0; r < table.getNumRows(); r++) {
      var row = table.getRow(r);
      if (row.getText().indexOf('<<lines.') < 0) continue;
      var at = r;
      lines.forEach(function (line) {
        var copy = row.copy(); var inserted = table.insertTableRow(at, copy); at++;
        Object.keys(line).forEach(function (f) { inserted.replaceText(re_('lines.' + f), esc_(line[f])); });
        inserted.replaceText('<<lines\\.[a-zA-Z0-9_]+>>', '');
      });
      table.removeRow(at); // hàng mẫu
      break;
    }
  }
}
