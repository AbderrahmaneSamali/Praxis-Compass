import {PDFDocument,StandardFonts,rgb,type PDFFont,type PDFPage} from 'pdf-lib';
import {careerReportDocument,type CareerReport,type ReportDocument} from './career-report.js';

const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const dateLabel=(date:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeStyle:'short',timeZone:'Africa/Casablanca'}).format(new Date(date));
export function renderCareerReportHtml(record:CareerReport){
 const doc=careerReportDocument(record);
 const blocks=doc.blocks.map(b=>{const tag=b.kind==='title'?'h1':b.kind==='heading'?'h2':b.kind==='subheading'?'h3':'p';
  return `<${tag}${b.anchor?` id="${escape(b.anchor)}"`:''} class="report-${b.kind}${b.pageBreak?' report-break':''}">${b.kind==='bullet'?'<span aria-hidden="true">• </span>':''}${escape(b.text)}</${tag}>`;
 }).join('\n');
 return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(doc.title)}</title><link rel="stylesheet" href="/report-document.css"><script defer src="/report-document.js"></script></head><body><nav class="report-toolbar" aria-label="Actions du rapport"><a href="/">Retour à PRAXIS</a><a href="/api/reports/${escape(doc.id)}/pdf" download>Télécharger le PDF</a><button id="print-report" type="button">Imprimer</button></nav><main class="report-document"><header><strong>PRAXIS / EXPLORATION</strong><p>Rapport enregistré le ${escape(dateLabel(doc.createdAt))} (heure de Casablanca)</p><p>Référence ${escape(doc.id)}</p></header><nav class="report-contents" aria-label="Sommaire"><a href="#context">Votre contexte</a><a href="#recommendations">Pistes</a><a href="#targets">Cibles détaillées</a><a href="#appendix">Annexe complète (${doc.candidateCount})</a><a href="#sources">Sources</a></nav>${blocks}</main></body></html>`;
}

// Normalise typographic spacing/dashes without dropping source text or truncating labels.
function pdfText(value:string){return value.normalize('NFC').replace(/[\u00a0\u202f\t]/g,' ').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\u200b/g,'').replace(/→/g,'->').replace(/←/g,'<-').replace(/≥/g,'>=').replace(/≤/g,'<=');}
function wrap(text:string,font:PDFFont,size:number,width:number){
 const lines:string[]=[];
 for(const paragraph of pdfText(text).split(/\r?\n/)){
  let line='';
  for(const word of paragraph.split(/\s+/).filter(Boolean)){
   const candidate=line?`${line} ${word}`:word;
   if(font.widthOfTextAtSize(candidate,size)<=width){line=candidate;continue;}
   if(line){lines.push(line);line='';}
   // Long identifiers/URLs may break between glyphs, never disappear outside the page.
   for(const char of word){if(line&&font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}line+=char;}
  }
  lines.push(line);
 }
 return lines;
}

export async function renderCareerReportPdf(record:CareerReport):Promise<Uint8Array>{return renderDocumentPdf(careerReportDocument(record));}
async function renderDocumentPdf(doc:ReportDocument){
 const pdf=await PDFDocument.create();pdf.setTitle(doc.title);pdf.setAuthor('PRAXIS');pdf.setCreator('PRAXIS career-report-v1');pdf.setProducer('PRAXIS / pdf-lib');
 pdf.setCreationDate(new Date(doc.createdAt));pdf.setModificationDate(new Date(doc.createdAt));pdf.setSubject(`Dossier ${doc.id} / ${doc.contentHash}`);pdf.setLanguage('fr-FR');
 const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),serif=await pdf.embedFont(StandardFonts.TimesRoman);
 const ink=rgb(.08,.23,.20),muted=rgb(.31,.41,.38),lineColor=rgb(.77,.83,.79),accent=rgb(.67,.33,.20);
 const width=595.28,height=841.89,margin=48,bottom=55,top=767;
 let page:PDFPage,y=top;
 const pages:PDFPage[]=[];
 const newPage=()=>{page=pdf.addPage([width,height]);pages.push(page);y=top;
  page.drawText('PRAXIS / EXPLORATION PROFESSIONNELLE',{x:margin,y:802,size:8.2,font:bold,color:ink});
  page.drawLine({start:{x:margin,y:787},end:{x:width-margin,y:787},color:lineColor,thickness:.7});};
 newPage();
 page!.drawText(pdfText(dateLabel(doc.createdAt)+' - heure de Casablanca'),{x:margin,y,size:9,font:regular,color:muted});y-=24;
 const ensure=(needed:number)=>{if(y-needed<bottom)newPage();};
 for(const block of doc.blocks){
  if(block.pageBreak&&y<top-20)newPage();
  const heading=['title','heading','subheading'].includes(block.kind);
  const size=block.kind==='title'?27:block.kind==='heading'?18:block.kind==='subheading'?11.2:block.kind==='note'?8.4:9.4;
  const font=block.kind==='title'||block.kind==='heading'?serif:block.kind==='subheading'?bold:regular;
  const indent=block.kind==='bullet'?12:0,leading=size*1.36;
  const lines=wrap(block.text,font,size,width-margin*2-indent);
  const before=block.kind==='heading'?18:block.kind==='subheading'?10:0;
  // Keep headings and at least two body lines together; body paragraphs flow across pages.
  ensure(Math.min(lines.length,heading?lines.length:2)*leading+before+(heading?30:0));y-=before;
  for(const [index,text] of lines.entries()){
   ensure(leading);
   if(index===0&&block.kind==='bullet')page!.drawText('•',{x:margin+1,y:y-size,font:regular,size,color:accent});
   page!.drawText(text,{x:margin+indent,y:y-size,size,font,color:block.kind==='note'?muted:ink});y-=leading;
  }
  y-=block.kind==='title'?16:block.kind==='note'?8:5;
 }
 for(const [index,p] of pages.entries()){
  p.drawLine({start:{x:margin,y:42},end:{x:width-margin,y:42},color:lineColor,thickness:.6});
  p.drawText(`PRAXIS - ${doc.id.slice(0,8)} - Données enregistrées`,{x:margin,y:28,font:regular,size:7.5,color:muted});
  const text=`${index+1} / ${pages.length}`;p.drawText(text,{x:width-margin-regular.widthOfTextAtSize(text,8),y:28,font:regular,size:8,color:muted});
 }
 return pdf.save({useObjectStreams:false});
}
