import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { formatCurrency, type CurrencyCode } from '@/constants/currencies';
import { Colors } from '@/theme/colors';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  slices: DonutSlice[];
  total: number;
  currency?: CurrencyCode;
  size?: number;
  strokeWidth?: number;
  subtitle?: string;
}

export function DonutChart({
  slices,
  total,
  currency = 'EUR',
  size = 188,
  strokeWidth = 24,
  subtitle = 'Total spent',
}: DonutChartProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const nonZero = slices.filter((s) => s.value > 0);
  const sum = nonZero.reduce((acc, s) => acc + s.value, 0);

  let cumulativeFraction = 0;

  return (
    <View style={styles.wrapper}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${center}, ${center}`}>
            <Circle
              cx={center}
              cy={center}
              r={radius}
              stroke={Colors.border}
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            {sum > 0 &&
              nonZero.map((slice) => {
                const fraction = slice.value / sum;
                const segmentLength = Math.max(0, fraction * circumference - 2);
                const strokeDasharray = `${segmentLength} ${circumference}`;
                const strokeDashoffset = -cumulativeFraction * circumference;
                cumulativeFraction += fraction;

                return (
                  <Circle
                    key={slice.key}
                    cx={center}
                    cy={center}
                    r={radius}
                    stroke={slice.color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDasharray}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="butt"
                    fill="transparent"
                  />
                );
              })}
          </G>
        </Svg>
        <View style={styles.centerOverlay} pointerEvents="none">
          <Text style={styles.centerSubtitle}>{subtitle}</Text>
          <Text style={styles.centerTotal} numberOfLines={1} adjustsFontSizeToFit>
            {formatCurrency(total, currency, total < 10000)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  centerSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 2,
  },
  centerTotal: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
});
