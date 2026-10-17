import { Routes } from '@angular/router';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { SettingsComponent } from './features/settings/settings.component';
import { HistoryComponent } from './features/history/history.component';
import { UsageComponent } from './features/usage/usage.component';
import { ProfileComponent } from './features/profile/profile.component';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', title: 'Dashboard · Aahvya Job Agent', component: DashboardComponent },
  { path: 'profile', title: 'Profile · Aahvya Job Agent', component: ProfileComponent },
  { path: 'settings', title: 'Settings · Aahvya Job Agent', component: SettingsComponent },
  { path: 'history', title: 'Application history · Aahvya Job Agent', component: HistoryComponent },
  { path: 'usage', title: 'AI usage · Aahvya Job Agent', component: UsageComponent },
  { path: '**', redirectTo: 'dashboard' }
];
