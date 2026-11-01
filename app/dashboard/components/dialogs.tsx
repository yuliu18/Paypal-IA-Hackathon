'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { SavedReport } from '../reports-store';
import { studioLabel } from '../studio/locale';
import { Button, Dialog } from './ui/ui';

// The shell's confirmation dialogs. Each takes its own open flag and callbacks, so the
// dashboard decides when they show and what happens next.

// Which dialog is open, if any. Only one shows at a time.
export type DashboardDialog =
  | { kind: 'unsaved'; then: () => void }
  | { kind: 'create' }
  | { kind: 'delete'; report: SavedReport }
  | { kind: 'reset' }
  | null;

export function UnsavedChangesDialog({
  open,
  reportName,
  onCancel,
  onDiscard,
  onSave,
}: {
  open: boolean;
  reportName: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const t = useTranslations('dashboard.dialogs');
  return (
    <Dialog
      open={open}
      title={t('unsaved.title', { name: reportName })}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button onClick={onDiscard}>{t('unsaved.discard')}</Button>
          <Button variant="primary" onClick={onSave}>
            {t('unsaved.save')}
          </Button>
        </>
      }
    >
      {t('unsaved.body')}
    </Dialog>
  );
}

export function CreateReportDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const formId = 'create-report';
  const t = useTranslations('dashboard.dialogs');
  const locale = useLocale();
  return (
    <Dialog
      open={open}
      title={t('create.title')}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId}>
            {t('create.submit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
          onCreate(name || t('create.defaultName'));
        }}
      >
        <p>{t('create.intro', { compose: studioLabel(locale, 'panelTitleEdit') })}</p>
        <label className="mt-4 block text-sm font-semibold text-pp-navy" htmlFor="report-name">
          {t('create.nameLabel')}
        </label>
        <input
          id="report-name"
          name="name"
          autoFocus
          defaultValue={t('create.defaultName')}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-1 h-11 w-full rounded border border-pp-border bg-pp-canvas px-3 text-[15px] text-pp-ink outline-none focus:border-pp-blue focus:ring-2 focus:ring-pp-highlight"
        />
      </form>
    </Dialog>
  );
}

/** Deletes a report, or resets the built-in one to the version shipped with the app. */
export function DeleteReportDialog({
  report,
  onCancel,
  onConfirm,
}: {
  report: SavedReport | null;
  onCancel: () => void;
  onConfirm: (report: SavedReport) => void;
}) {
  const t = useTranslations('dashboard.dialogs');
  return (
    <Dialog
      open={report !== null}
      title={report?.builtIn ? t('delete.titleReset') : t('delete.title')}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button variant="danger" onClick={() => report && onConfirm(report)}>
            {report?.builtIn ? t('delete.reset') : t('delete.delete')}
          </Button>
        </>
      }
    >
      {report && (report.builtIn ? t('delete.bodyReset', { name: report.name }) : t('delete.body', { name: report.name }))}
    </Dialog>
  );
}

export function ResetDemoDialog({
  open,
  builtInName,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  builtInName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('dashboard.dialogs');
  return (
    <Dialog
      open={open}
      title={t('resetDemo.title')}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t('resetDemo.confirm')}
          </Button>
        </>
      }
    >
      {t('resetDemo.body', { name: builtInName })}
    </Dialog>
  );
}
