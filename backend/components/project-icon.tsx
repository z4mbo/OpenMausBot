"use client";

import { useState } from "react";
import { Activity, Aperture, Bell, BookOpen, Box, BriefcaseBusiness, Calendar, Camera, ChartNoAxesCombined, Circle, Cloud, Code2, Coffee, Compass, Cpu, Database, Diamond, FileText, Film, Flag, Flame, Folder, Gamepad2, Gem, GitBranch, Globe, GraduationCap, Heart, House, Layers, Lightbulb, Map, Megaphone, MessageCircle, Mic, Monitor, Moon, Music, Paintbrush, Palette, PenTool, Rocket, Search, ShieldCheck, ShoppingBag, Smartphone, Sparkles, Star, Sun, Target, Terminal, Trophy, Users, Wallet, Wrench, Zap } from "lucide-react";

export const projectIconOptions = [
  { value: "circle", label: "Circle", icon: Circle }, { value: "repo", label: "Repository", icon: GitBranch },
  { value: "spark", label: "Spark", icon: Sparkles }, { value: "shield", label: "Security", icon: ShieldCheck },
  { value: "users", label: "Team", icon: Users }, { value: "rocket", label: "Rocket", icon: Rocket },
  { value: "code", label: "Code", icon: Code2 }, { value: "terminal", label: "Terminal", icon: Terminal },
  { value: "cpu", label: "Processor", icon: Cpu }, { value: "database", label: "Database", icon: Database },
  { value: "cloud", label: "Cloud", icon: Cloud }, { value: "globe", label: "Website", icon: Globe },
  { value: "monitor", label: "Desktop", icon: Monitor }, { value: "phone", label: "Mobile", icon: Smartphone },
  { value: "layers", label: "Layers", icon: Layers }, { value: "box", label: "Package", icon: Box },
  { value: "palette", label: "Palette", icon: Palette }, { value: "pen", label: "Design", icon: PenTool },
  { value: "brush", label: "Paintbrush", icon: Paintbrush }, { value: "camera", label: "Camera", icon: Camera },
  { value: "aperture", label: "Photography", icon: Aperture }, { value: "film", label: "Video", icon: Film },
  { value: "music", label: "Music", icon: Music }, { value: "mic", label: "Audio", icon: Mic },
  { value: "game", label: "Gaming", icon: Gamepad2 }, { value: "book", label: "Book", icon: BookOpen },
  { value: "education", label: "Education", icon: GraduationCap }, { value: "document", label: "Document", icon: FileText },
  { value: "folder", label: "Folder", icon: Folder }, { value: "calendar", label: "Calendar", icon: Calendar },
  { value: "message", label: "Chat", icon: MessageCircle }, { value: "bell", label: "Notification", icon: Bell },
  { value: "megaphone", label: "Marketing", icon: Megaphone }, { value: "briefcase", label: "Business", icon: BriefcaseBusiness },
  { value: "shop", label: "Shopping", icon: ShoppingBag }, { value: "wallet", label: "Finance", icon: Wallet },
  { value: "chart", label: "Analytics", icon: ChartNoAxesCombined }, { value: "activity", label: "Activity", icon: Activity },
  { value: "house", label: "Home", icon: House }, { value: "map", label: "Map", icon: Map },
  { value: "compass", label: "Explore", icon: Compass }, { value: "target", label: "Target", icon: Target },
  { value: "flag", label: "Flag", icon: Flag }, { value: "trophy", label: "Trophy", icon: Trophy },
  { value: "heart", label: "Heart", icon: Heart }, { value: "star", label: "Star", icon: Star },
  { value: "sun", label: "Sun", icon: Sun }, { value: "moon", label: "Moon", icon: Moon },
  { value: "flame", label: "Fire", icon: Flame }, { value: "zap", label: "Lightning", icon: Zap },
  { value: "lightbulb", label: "Idea", icon: Lightbulb }, { value: "gem", label: "Gem", icon: Gem },
  { value: "diamond", label: "Diamond", icon: Diamond }, { value: "coffee", label: "Coffee", icon: Coffee },
  { value: "wrench", label: "Tools", icon: Wrench },
];

export function ProjectIcon({ project, size = 18 }: { project: { iconType?: string; iconValue?: string; iconUrl?: string | null }; size?: number }) {
  if (project.iconType === "image" && project.iconUrl) return <img className="project-icon image" src={project.iconUrl} alt="" />;
  if (project.iconType === "emoji" && project.iconValue) return <span className="project-icon emoji" aria-hidden="true">{project.iconValue}</span>;
  const Icon = project.iconType === "icon" ? (projectIconOptions.find(item => item.value === project.iconValue)?.icon || Circle) : Circle;
  return <Icon className="project-icon plain" size={size} aria-hidden="true" />;
}

export function ProjectIconPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const icons = projectIconOptions.filter(item => `${item.label} ${item.value}`.toLowerCase().includes(search.toLowerCase().trim()));
  return <div className="project-icon-library"><label className="icon-library-search"><Search size={15} /><input type="search" aria-label="Search icons" placeholder="Search icons" value={search} onChange={e => setSearch(e.target.value)} /></label><div className="icon-library-grid" role="group" aria-label="Project icon">{icons.map(({ value: id, label, icon: Icon }) => <button key={id} type="button" aria-label={label} title={label} aria-pressed={id === value} onClick={() => onChange(id)}><Icon size={20} /></button>)}</div>{!icons.length && <p className="muted">No matching icons</p>}</div>;
}
