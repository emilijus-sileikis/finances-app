import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import type { Language } from '@/i18n/translations';
import { Colors } from '@/theme/colors';
import { formatEur, formatShortMonth } from '@/utils/format';

interface TrendPoint {
  monthKey: string;
  total: number;
}

interface TrendBarChartProps {
  data: TrendPoint[];
  selectedMonth: string;
  language?: Language;
  emptyLabel?: string;
}

export function TrendBarChart({
  data,
  selectedMonth,
  language = 'en',
  emptyLabel = 'Add expenses to see your 6-month trend',
}: TrendBarChartProps) {
  const maxVal = Math.max(100, ...data.map((d) => d.total));
  const chartHeight = 148;
  const barAreaHeight = 104;
  const chartWidth = 320;
  const colWidth = chartWidth / Math.max(1, data.length);
  const barWidth = Math.min(30, colWidth * 0.52);

  return (
    <View style={styles.container}>
      <Svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
        {data.map((point, idx) => {
          const isSelected = point.monthKey === selectedMonth;
          const rawHeight = (point.total / maxVal) * barAreaHeight;
          const barHeight = point.total > 0 ? Math.max(6, rawHeight) : 3;
          const x = idx * colWidth + (colWidth - barWidth) / 2;
          const y = barAreaHeight - barHeight + 22;

          return (
            <React.Fragment key={point.monthKey}>
              {point.total > 0 && (
                <SvgText
                  x={x + barWidth / 2}
                  y={y - 6}
                  fill={isSelected ? Colors.text : Colors.textSecondary}
                  fontSize="10"
                  fontWeight={isSelected ? '700' : '500'}
                  textAnchor="middle"
                >
                  {formatEur(point.total, false)}
                </SvgText>
              )}
              <Rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={6}
                ry={6}
                fill={
                  point.total === 0
                    ? Colors.border
                    : isSelected
                      ? Colors.primary
                      : Colors.borderLight
                }
              />
              <SvgText
                x={x + barWidth / 2}
                y={chartHeight - 4}
                fill={isSelected ? Colors.primary : Colors.textSecondary}
                fontSize="11"
                fontWeight={isSelected ? '700' : '500'}
                textAnchor="middle"
              >
                {formatShortMonth(point.monthKey, language)}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
      {data.every((d) => d.total === 0) && (
        <Text style={styles.emptyNote}>{emptyLabel}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  emptyNote: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
});
