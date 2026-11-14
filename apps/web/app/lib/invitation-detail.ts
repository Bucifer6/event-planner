import { formatDate, type Locale } from '@eventdesk/shared';

export function invitationDetail(
  occasion: {
    dateStart: Date | null;
    dateEnd: Date | null;
    dateMode: string;
    venueAddress: string | null;
  },
  locale: Locale
) {
  const start = occasion.dateStart ? formatDate(occasion.dateStart, locale) : '';
  const end = occasion.dateEnd ? formatDate(occasion.dateEnd, locale) : '';
  const date =
    occasion.dateMode === 'range' && start && end && end !== start ? start + ' – ' + end : start;
  return [date, occasion.venueAddress].filter(Boolean).join(' · ');
}
