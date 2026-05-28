import JSZip from 'jszip';

/**
 * Post-process an ExcelJS-generated XLSX buffer and inject native OOXML barCharts
 * per the provided specs. Unlike embedded PNG images, these charts are editable
 * inside Excel (right-click → Change Chart Type / Select Data / …).
 *
 * A single chart spec:
 *   {
 *     title: 'Settled vs Issued',
 *     categoriesRef: "'Summary'!$B$5:$D$5",
 *     categoriesCache: ['Jan 2026', 'Feb 2026', 'Mar 2026'],
 *     series: [
 *       {
 *         nameRef: "'Summary'!$A$6",
 *         nameCache: 'Settled Loans',
 *         valuesRef: "'Summary'!$B$6:$D$6",
 *         valuesCache: [123, 456, 789],
 *         color: '0B2A6B',
 *       },
 *       …
 *     ],
 *     anchor: { fromCol: 0, fromRow: 10, toCol: 8, toRow: 30 },
 *     valueNumFmt: '#,##0',
 *   }
 *
 * The charts are bundled in a per-sheet `specsBySheet` array:
 *   [{ sheetName: 'Summary', charts: [spec1, spec2, …] }, …]
 */

const CHART_NS =
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const DRAWING_NS =
  'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';

const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

const xmlEscape = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const strCache = (values) => {
  const items = values
    .map((v, i) => `<c:pt idx="${i}"><c:v>${xmlEscape(v)}</c:v></c:pt>`)
    .join('');
  return `<c:strCache><c:ptCount val="${values.length}"/>${items}</c:strCache>`;
};

const numCache = (values, formatCode) => {
  const items = values
    .map((v, i) => {
      const n = Number(v);
      const val = isFinite(n) ? n : 0;
      return `<c:pt idx="${i}"><c:v>${val}</c:v></c:pt>`;
    })
    .join('');
  return (
    '<c:numCache>' +
    `<c:formatCode>${xmlEscape(formatCode)}</c:formatCode>` +
    `<c:ptCount val="${values.length}"/>` +
    items +
    '</c:numCache>'
  );
};

const buildChartXml = (spec, axIdBase) => {
  const {
    title = '',
    categoriesRef,
    categoriesCache = [],
    series = [],
    valueNumFmt = '#,##0',
    gapWidth = 120,
    overlap = -10,
  } = spec;

  const catAxId = axIdBase;
  const valAxId = axIdBase + 1;

  const serializedSeries = series
    .map((s, i) => {
      const color = (s.color || '4472C4').replace(/^#/, '').toUpperCase();
      const sName = s.nameCache != null ? s.nameCache : '';
      return `
        <c:ser>
          <c:idx val="${i}"/>
          <c:order val="${i}"/>
          <c:tx>
            <c:strRef>
              <c:f>${xmlEscape(s.nameRef)}</c:f>
              ${strCache([sName])}
            </c:strRef>
          </c:tx>
          <c:spPr>
            <a:gradFill flip="none" rotWithShape="1">
              <a:gsLst>
                <a:gs pos="0"><a:srgbClr val="${color}"><a:lumMod val="110000"/></a:srgbClr></a:gs>
                <a:gs pos="100000"><a:srgbClr val="${color}"><a:lumMod val="70000"/></a:srgbClr></a:gs>
              </a:gsLst>
              <a:lin ang="5400000" scaled="0"/>
            </a:gradFill>
            <a:ln w="9525">
              <a:solidFill><a:srgbClr val="${color}"><a:lumMod val="60000"/></a:srgbClr></a:solidFill>
            </a:ln>
            <a:effectLst>
              <a:outerShdw blurRad="40000" dist="20000" dir="5400000" rotWithShape="0">
                <a:srgbClr val="000000"><a:alpha val="25000"/></a:srgbClr>
              </a:outerShdw>
            </a:effectLst>
          </c:spPr>
          <c:invertIfNegative val="0"/>
          <c:cat>
            <c:strRef>
              <c:f>${xmlEscape(categoriesRef)}</c:f>
              ${strCache(categoriesCache)}
            </c:strRef>
          </c:cat>
          <c:val>
            <c:numRef>
              <c:f>${xmlEscape(s.valuesRef)}</c:f>
              ${numCache(s.valuesCache || [], valueNumFmt)}
            </c:numRef>
          </c:val>
          <c:smooth val="0"/>
        </c:ser>`;
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<c:chartSpace ${CHART_NS}>` +
    '<c:roundedCorners val="0"/>' +
    '<c:chart>' +
    `<c:title>
        <c:tx>
          <c:rich>
            <a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/>
            <a:lstStyle/>
            <a:p>
              <a:pPr>
                <a:defRPr sz="800" b="1" kern="1200" spc="0" baseline="0">
                  <a:solidFill><a:srgbClr val="0F172A"/></a:solidFill>
                  <a:latin typeface="Malgun Gothic"/>
                  <a:ea typeface="Malgun Gothic"/>
                  <a:cs typeface="Malgun Gothic"/>
                </a:defRPr>
              </a:pPr>
              <a:r>
                <a:rPr lang="en-US" sz="800" b="1">
                  <a:solidFill><a:srgbClr val="0F172A"/></a:solidFill>
                  <a:latin typeface="Malgun Gothic"/>
                  <a:ea typeface="Malgun Gothic"/>
                  <a:cs typeface="Malgun Gothic"/>
                </a:rPr>
                <a:t>${xmlEscape(title)}</a:t>
              </a:r>
            </a:p>
          </c:rich>
        </c:tx>
        <c:overlay val="0"/>
        <c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
      </c:title>` +
    '<c:autoTitleDeleted val="0"/>' +
    '<c:plotArea>' +
    '<c:layout/>' +
    `<c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        ${serializedSeries}
        <c:dLbls>
          <c:showLegendKey val="0"/>
          <c:showVal val="0"/>
          <c:showCatName val="0"/>
          <c:showSerName val="0"/>
          <c:showPercent val="0"/>
          <c:showBubbleSize val="0"/>
        </c:dLbls>
        <c:gapWidth val="${gapWidth}"/>
        <c:overlap val="${overlap}"/>
        <c:axId val="${catAxId}"/>
        <c:axId val="${valAxId}"/>
      </c:barChart>` +
    `<c:catAx>
        <c:axId val="${catAxId}"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:numFmt formatCode="General" sourceLinked="1"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:txPr>
          <a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/>
          <a:lstStyle/>
          <a:p><a:pPr><a:defRPr sz="800" b="0" kern="1200"><a:solidFill><a:srgbClr val="334155"/></a:solidFill><a:latin typeface="Malgun Gothic"/><a:ea typeface="Malgun Gothic"/><a:cs typeface="Malgun Gothic"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p>
        </c:txPr>
        <c:crossAx val="${valAxId}"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
        <c:noMultiLvlLbl val="0"/>
      </c:catAx>` +
    `<c:valAx>
        <c:axId val="${valAxId}"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorGridlines>
          <c:spPr>
            <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">
              <a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill>
              <a:round/>
            </a:ln>
          </c:spPr>
        </c:majorGridlines>
        <c:numFmt formatCode="${xmlEscape(valueNumFmt)}" sourceLinked="0"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:spPr>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </c:spPr>
        <c:txPr>
          <a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/>
          <a:lstStyle/>
          <a:p><a:pPr><a:defRPr sz="800" b="0" kern="1200"><a:solidFill><a:srgbClr val="334155"/></a:solidFill><a:latin typeface="Malgun Gothic"/><a:ea typeface="Malgun Gothic"/><a:cs typeface="Malgun Gothic"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p>
        </c:txPr>
        <c:crossAx val="${catAxId}"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="between"/>
      </c:valAx>` +
    '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
    '</c:plotArea>' +
    `<c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
      <c:txPr>
        <a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/>
        <a:lstStyle/>
        <a:p><a:pPr><a:defRPr sz="800" b="1" kern="1200"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill><a:latin typeface="Malgun Gothic"/><a:ea typeface="Malgun Gothic"/><a:cs typeface="Malgun Gothic"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p>
      </c:txPr>
    </c:legend>` +
    '<c:plotVisOnly val="1"/>' +
    '<c:dispBlanksAs val="gap"/>' +
    '</c:chart>' +
    '</c:chartSpace>'
  );
};

const buildDrawingXml = (charts) => {
  const anchors = charts
    .map((c, i) => {
      const a = c.anchor;
      const chartRelId = `rId${i + 1}`;
      return `
        <xdr:twoCellAnchor editAs="oneCell">
          <xdr:from>
            <xdr:col>${a.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff>
            <xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff>
          </xdr:from>
          <xdr:to>
            <xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff>
            <xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff>
          </xdr:to>
          <xdr:graphicFrame macro="">
            <xdr:nvGraphicFramePr>
              <xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/>
              <xdr:cNvGraphicFramePr/>
            </xdr:nvGraphicFramePr>
            <xdr:xfrm>
              <a:off x="0" y="0"/>
              <a:ext cx="0" cy="0"/>
            </xdr:xfrm>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
                <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${chartRelId}"/>
              </a:graphicData>
            </a:graphic>
          </xdr:graphicFrame>
          <xdr:clientData/>
        </xdr:twoCellAnchor>`;
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<xdr:wsDr ${DRAWING_NS}>${anchors}</xdr:wsDr>`
  );
};

const buildDrawingRels = (chartCount, startChartIndex) => {
  const items = [];
  for (let i = 0; i < chartCount; i++) {
    const chartNum = startChartIndex + i;
    items.push(
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNum}.xml"/>`
    );
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships ${REL_NS}>${items.join('')}</Relationships>`
  );
};

const addDrawingRelToSheetRels = (xml, drawingNum) => {
  const rel = `<Relationship Id="rIdDraw${drawingNum}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNum}.xml"/>`;
  if (!xml) {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships ${REL_NS}>${rel}</Relationships>`
    );
  }
  return xml.replace('</Relationships>', `${rel}</Relationships>`);
};

const addDrawingToSheetXml = (xml, drawingNum) => {
  // Strip any existing drawing tags from ExcelJS first.
  let cleaned = xml.replace(/<drawing [^/]*\/>/g, '');
  const drawingTag = `<drawing r:id="rIdDraw${drawingNum}"/>`;
  if (/<pageMargins[^>]*\/>/.test(cleaned)) {
    cleaned = cleaned.replace(/(<pageMargins[^>]*\/>)/, `$1${drawingTag}`);
  } else {
    cleaned = cleaned.replace('</worksheet>', `${drawingTag}</worksheet>`);
  }
  return cleaned;
};

const attr = (xml, name) => {
  // Escape colons and other regex-meaningful characters so r:id still works.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = xml.match(new RegExp(`${escaped}="([^"]*)"`));
  return m ? m[1] : '';
};

const readTextSafe = async (zip, path) => {
  const entry = zip.file(path);
  if (!entry) return null;
  return entry.async('text');
};

const findFirstExisting = async (zip, candidates) => {
  for (const p of candidates) {
    const entry = zip.file(p);
    if (entry) return { path: p, entry };
  }
  return null;
};

const readWorkbookSheets = async (zip) => {
  const wbXml = await readTextSafe(zip, 'xl/workbook.xml');
  const wbRels = await readTextSafe(zip, 'xl/_rels/workbook.xml.rels');
  if (!wbXml || !wbRels) {
    throw new Error('nativeChartsInjector: xl/workbook.xml or xl/_rels/workbook.xml.rels missing');
  }

  // ExcelJS writes sheet attributes in variable order (sheetId, name, state, r:id).
  // Parse each <sheet .../> tag independently so order doesn't matter.
  const sheets = [];
  const sheetTagRe = /<sheet\s+[^/]*\/>/g;
  let m;
  while ((m = sheetTagRe.exec(wbXml))) {
    const tag = m[0];
    const name = attr(tag, 'name');
    const rId = attr(tag, 'r:id') || attr(tag, 'r:Id');
    if (name && rId) sheets.push({ name, rId });
  }

  const relMap = new Map();
  const relTagRe = /<Relationship\s+[^/]*\/>/g;
  while ((m = relTagRe.exec(wbRels))) {
    const tag = m[0];
    const id = attr(tag, 'Id');
    const target = attr(tag, 'Target');
    if (id && target) relMap.set(id, target);
  }

  return sheets.map((s) => ({ name: s.name, target: relMap.get(s.rId) || '' }));
};

export const injectNativeCharts = async (buffer, specsBySheet) => {
  const zip = await JSZip.loadAsync(buffer);
  const sheets = await readWorkbookSheets(zip);

  const specMap = new Map();
  for (const s of specsBySheet) specMap.set(s.sheetName, s.charts || []);

  let chartCounter = 0;
  let drawingCounter = 0;
  const chartContentTypes = [];
  const drawingContentTypes = [];

  for (const sheet of sheets) {
    const charts = specMap.get(sheet.name);
    if (!charts || !charts.length) continue;
    if (!sheet.target) {
       
      console.warn(`nativeChartsInjector: could not resolve target for sheet "${sheet.name}", skipping.`);
      continue;
    }

    // Resolve the actual sheet XML part. The target in workbook.xml.rels is
    // usually "worksheets/sheet1.xml" (relative to xl/), but a few producers
    // emit "/xl/worksheets/sheet1.xml" (absolute) or similar — normalise both.
    const rawTarget = sheet.target.replace(/^\/+/, '');
    const candidateSheetPaths = [
      rawTarget.startsWith('xl/') ? rawTarget : `xl/${rawTarget}`,
      rawTarget,
    ];
    const resolvedSheet = await findFirstExisting(zip, candidateSheetPaths);
    if (!resolvedSheet) {
       
      console.warn(`nativeChartsInjector: sheet xml not found for "${sheet.name}" (tried ${candidateSheetPaths.join(', ')}), skipping.`);
      continue;
    }
    const sheetPath = resolvedSheet.path;
    const sheetFile = sheetPath.split('/').pop();
    const sheetRelPath = `xl/worksheets/_rels/${sheetFile}.rels`;

    drawingCounter += 1;
    const startChartIdx = chartCounter + 1;

    charts.forEach((spec) => {
      chartCounter += 1;
      zip.file(
        `xl/charts/chart${chartCounter}.xml`,
        buildChartXml(spec, 100000 + chartCounter * 2)
      );
      chartContentTypes.push(chartCounter);
    });

    zip.file(`xl/drawings/drawing${drawingCounter}.xml`, buildDrawingXml(charts));
    drawingContentTypes.push(drawingCounter);

    zip.file(
      `xl/drawings/_rels/drawing${drawingCounter}.xml.rels`,
      buildDrawingRels(charts.length, startChartIdx)
    );

    const existingRels = (await readTextSafe(zip, sheetRelPath)) || '';
    zip.file(sheetRelPath, addDrawingRelToSheetRels(existingRels, drawingCounter));

    const sheetXml = await resolvedSheet.entry.async('text');
    zip.file(sheetPath, addDrawingToSheetXml(sheetXml, drawingCounter));
  }

  // [Content_Types].xml lives at the zip root. Fall back to a case-insensitive
  // scan if the exact name isn't found (extremely unlikely but cheap to guard).
  let ct = await readTextSafe(zip, '[Content_Types].xml');
  let contentTypesPath = '[Content_Types].xml';
  if (!ct) {
    for (const fileName of Object.keys(zip.files)) {
      if (fileName.toLowerCase() === '[content_types].xml') {
        contentTypesPath = fileName;
        ct = await zip.file(fileName).async('text');
        break;
      }
    }
  }
  if (!ct) {
    throw new Error('nativeChartsInjector: [Content_Types].xml missing from workbook');
  }
  for (const n of drawingContentTypes) {
    const override = `<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
    if (!ct.includes(override)) ct = ct.replace('</Types>', `${override}</Types>`);
  }
  for (const n of chartContentTypes) {
    const override = `<Override PartName="/xl/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
    if (!ct.includes(override)) ct = ct.replace('</Types>', `${override}</Types>`);
  }
  zip.file(contentTypesPath, ct);

  return await zip.generateAsync({ type: 'arraybuffer' });
};
