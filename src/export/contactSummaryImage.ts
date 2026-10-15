import type { ContactCallSummary } from "@/data/contactSummary";
import { formatCompactDuration, formatDate, formatDuration } from "@/utils/format";

const WIDTH = 1080;
const HEIGHT = 1920;
const FONT = '"Segoe UI Variable", "Microsoft YaHei UI", sans-serif';
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", sans-serif';

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string | CanvasGradient
) {
  roundedRect(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  color: string,
  align: CanvasTextAlign = "left",
  maxWidth?: number,
  minSize = 16
) {
  let fittedSize = size;
  context.font = `${weight} ${fittedSize}px ${FONT}`;
  while (maxWidth && fittedSize > minSize && context.measureText(text).width > maxWidth) {
    fittedSize -= 2;
    context.font = `${weight} ${fittedSize}px ${FONT}`;
  }
  let fittedText = text;
  const characters = Array.from(text);
  while (maxWidth && characters.length > 1 && context.measureText(fittedText).width > maxWidth) {
    characters.pop();
    fittedText = `${characters.join("")}…`;
  }
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "alphabetic";
  context.fillText(fittedText, x, y);
}

async function loadImage(source?: string | null): Promise<HTMLImageElement | null> {
  if (!source || (!source.startsWith("data:") && !source.startsWith("blob:"))) return null;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function drawAvatar(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  label: string,
  x: number,
  y: number,
  size: number
) {
  context.save();
  context.shadowColor = "rgba(76, 58, 118, .22)";
  context.shadowBlur = 34;
  context.shadowOffsetY = 14;
  fillRoundedRect(context, x, y, size, size, 48, "rgba(255,255,255,.92)");
  context.restore();

  context.save();
  roundedRect(context, x + 8, y + 8, size - 16, size - 16, 41);
  context.clip();
  if (image) {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - side) / 2;
    const sourceY = (image.naturalHeight - side) / 2;
    context.drawImage(image, sourceX, sourceY, side, side, x + 8, y + 8, size - 16, size - 16);
  } else {
    const avatarGradient = context.createLinearGradient(x, y, x + size, y + size);
    avatarGradient.addColorStop(0, "#eee9ff");
    avatarGradient.addColorStop(1, "#d9cdfb");
    context.fillStyle = avatarGradient;
    context.fillRect(x + 8, y + 8, size - 16, size - 16);
    drawText(context, label.slice(0, 1) || "?", x + size / 2, y + size / 2 + 26, 68, 850, "#6852b5", "center");
  }
  context.restore();
}

interface MetricCard {
  icon: string;
  label: string;
  value: string;
  note: string;
  from: string;
  to: string;
  valueSize?: number;
}

function drawMetricCard(
  context: CanvasRenderingContext2D,
  card: MetricCard,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const gradient = context.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, card.from);
  gradient.addColorStop(1, card.to);
  context.save();
  context.shadowColor = "rgba(67, 50, 96, .09)";
  context.shadowBlur = 28;
  context.shadowOffsetY = 12;
  fillRoundedRect(context, x, y, width, height, 38, gradient);
  context.restore();

  context.font = `400 50px ${EMOJI_FONT}`;
  context.textAlign = "left";
  context.fillText(card.icon, x + 34, y + 68);
  drawText(context, card.label, x + 34, y + 122, 24, 700, "rgba(48,40,63,.62)", "left", width - 68);
  drawText(context, card.value, x + 34, y + 188, card.valueSize ?? 42, 850, "#312a40", "left", width - 68, 22);
  drawText(context, card.note, x + 34, y + 232, 21, 650, "rgba(48,40,63,.55)", "left", width - 68, 16);
}

const compactDuration = (seconds: number) =>
  seconds < 60 ? `${seconds} 秒` : formatCompactDuration(seconds);

const safeFilePart = (value: string) =>
  value.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 40) || "联系人";

export function contactSummaryFileName(summary: ContactCallSummary): string {
  return `${safeFilePart(summary.contact.displayName)}-通话总结.png`;
}

export async function createContactSummaryPng(summary: ContactCallSummary): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法生成图片。")

  const background = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#fbfaf8");
  background.addColorStop(.48, "#f4f0ff");
  background.addColorStop(1, "#fff0e9");
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.globalAlpha = .34;
  context.fillStyle = "#d6c7ff";
  context.beginPath();
  context.arc(72, 320, 250, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffd5c5";
  context.beginPath();
  context.arc(1030, 760, 330, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  fillRoundedRect(context, 74, 68, 82, 82, 28, "#8069d1");
  context.font = `400 43px ${EMOJI_FONT}`;
  context.textAlign = "center";
  context.fillText("📞", 115, 126);
  drawText(context, "通话足迹", 178, 124, 31, 850, "#292435");
  drawText(context, "属于你们的通话总结", 1004, 118, 21, 650, "#8b8293", "right", 420);

  const avatar = await loadImage(summary.contact.avatarRef);
  drawAvatar(context, avatar, summary.contact.displayName, 440, 220, 200);
  drawText(context, `我和 ${summary.contact.displayName} 的`, WIDTH / 2, 486, 30, 700, "#756b80", "center", 820, 18);
  drawText(context, "通话足迹", WIDTH / 2, 556, 60, 900, "#292435", "center");
  const range = !summary.timeInsightsComplete || !summary.durationComplete
    ? "部分记录日期、时区或时长未知"
    : summary.firstCallDate && summary.lastCallDate
      ? `${formatDate(summary.firstCallDate)} — ${formatDate(summary.lastCallDate)}`
      : "暂无可用日期";
  drawText(context, range, WIDTH / 2, 608, 23, 650, "#8b8293", "center", 800);

  const heroGradient = context.createLinearGradient(74, 680, 1006, 1008);
  heroGradient.addColorStop(0, "#7862c8");
  heroGradient.addColorStop(.52, "#9a7ddd");
  heroGradient.addColorStop(1, "#e497b4");
  context.save();
  context.shadowColor = "rgba(105, 78, 167, .25)";
  context.shadowBlur = 42;
  context.shadowOffsetY = 19;
  fillRoundedRect(context, 74, 678, 932, 332, 52, heroGradient);
  context.restore();
  const durationLabel = summary.durationComplete ? "当前记录内接通总时长" : "当前记录内已知接通时长";
  const durationValue = summary.timedCount > 0
    ? compactDuration(summary.totalDurationSeconds)
    : summary.connectedCount > 0 ? "时长未知" : "0 分钟";
  const durationNote = summary.untimedConnectedCount > 0
    ? `${summary.connectedCount} 次确认接通 · ${summary.untimedConnectedCount} 次时长未知`
    : `${summary.connectedCount} 次已接通通话`;
  drawText(context, durationLabel, 132, 758, 25, 700, "rgba(255,255,255,.78)");
  drawText(context, durationValue, 132, 862, 66, 900, "#ffffff", "left", 610, 36);
  drawText(context, durationNote, 132, 922, 25, 700, "rgba(255,255,255,.78)", "left", 650, 18);
  context.font = `400 90px ${EMOJI_FONT}`;
  context.textAlign = "center";
  context.fillText("💬", 864, 878);

  const longestDate = !summary.durationComplete || !summary.timeInsightsComplete
    ? "暂无法判断"
    : summary.longestCallDurationSeconds === null
      ? "暂无"
      : summary.longestCallDate ? formatDate(summary.longestCallDate) : "日期未知";
  const longestDuration = !summary.durationComplete
    ? `${summary.untimedConnectedCount} 次接通时长未知`
    : !summary.timeInsightsComplete
      ? "部分记录日期或时区未知"
      : summary.longestCallDurationSeconds === null
        ? "没有可用时长"
        : `${summary.longestCallDate ? "当天最长" : "最长通话"} ${formatDuration(summary.longestCallDurationSeconds)}`;
  const favorite = summary.favoritePeriod;
  const streakValue = summary.timeInsightsComplete
    ? `${summary.longestStreakDays} 天`
    : "暂无法判断";
  const streakNote = summary.timeInsightsComplete
    ? summary.longestStreakDays ? "每天都有已接通通话" : "暂无连续通话"
    : "部分记录日期或时区未知";
  const cards: MetricCard[] = [
    { icon: "📅", label: "当前记录内最长通话日期", value: longestDate, note: longestDuration, from: "#eee9ff", to: "#ded4ff", valueSize: 37 },
    { icon: "🔥", label: "最长连续通话", value: streakValue, note: streakNote, from: "#fff0e7", to: "#ffd9ca", valueSize: 38 },
    { icon: "🕘", label: "最常通话时段", value: favorite?.label ?? "时段未知", note: favorite ? `${favorite.rangeLabel} · ${favorite.count} 次` : "部分记录时间或时区未知", from: "#e5f7f0", to: "#ccefe3", valueSize: 38 },
    { icon: "📞", label: "当前记录内接通次数", value: `${summary.connectedCount} 次`, note: summary.untimedConnectedCount ? `${summary.untimedConnectedCount} 次时长未知` : "仅统计确认接通的通话", from: "#e8f3fc", to: "#d7eafe" }
  ];
  const positions = [[74, 1060], [558, 1060], [74, 1364], [558, 1364]];
  cards.forEach((card, index) => {
    const [x, y] = positions[index];
    drawMetricCard(context, card, x, y, 448, 270);
  });

  const qualityNote = summary.durationComplete && summary.timeInsightsComplete && !summary.hasQualityWarnings
    ? "根据当前已保存记录整理 · 不包含聊天内容"
    : "当前已保存记录部分信息不完整 · 只展示可以确认的内容";
  drawText(context, "每一次接通，都留下了一点共同的时间。", WIDTH / 2, 1740, 27, 700, "#665a72", "center", 900, 20);
  drawText(context, qualityNote, WIDTH / 2, 1802, 20, 650, "#998fa1", "center", 900, 16);
  const generatedAt = new Date();
  drawText(
    context,
    `${generatedAt.getFullYear()} 年 ${generatedAt.getMonth() + 1} 月 ${generatedAt.getDate()} 日生成`,
    WIDTH / 2,
    1842,
    18,
    650,
    "#aea5b3",
    "center"
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("图片生成失败，请稍后重试。")),
      "image/png"
    );
  });
}
