// Copyright (c) 2022 Levi Gruspe
// License: GNU AGPLv3 or later

// For computing Wilson score intervals
package wilson

import (
	"math"
)

// Computes a boundary point of a Wilson score interval.
// See https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm
// Also see https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval
// Or https://www.ncss.com/wp-content/themes/ncss/pdf/Procedures/PASS/Confidence_Intervals_for_One_Proportion.pdf
//
// How to pick z for a given significance level a: (confidence level would be
// 1 - a).
//
// Lower bound (double-sided):
// - z of the value such that the area to left of the value is a/2.
//
// Upper bound (double-sided):
// - z of the value such that the area to the left of the value is 1 - a/2.
//
// Lower bound (one-sided):
// - z of the value such that the area to the left of the value is a.
//
// Upper bound (one-sided):
// - z of the value such that the area to the left of the value is 1-a.
//
// Examples:
// confidence	significance (a)	one-sided lower-bound z-score	upper bound
// ----------	----------------	-----------------------------	-----------
// 0.80				0.20							-0.845												0.845
// 0.90				0.10							-1.285												1.285
// 0.95				0.05							-1.645												1.645
// 0.99				0.01							-2.325												2.325
// 0.999			0.001							-3.1													3.1
func Wilson(success, fail int, z float64) float64 {
	ns := float64(success)
	nf := float64(fail)
	n := ns + nf
	z2 := z * z
	return (ns+z2/2)/(n+z2) + (z/(n+z2))*math.Sqrt((ns*nf)/n+z2/4)
}

func IsTooEasy(correct, incorrect int) bool {
	// Threshold can't be too high or the tuner will be too conservative.
	// Only uses 0.80 confidence, higher values require too many samples.

	z := -0.845 // z-score for one-sided confidence interval (80% confidence)
	lower := Wilson(correct, incorrect, z)

	// 80% likelihood that the true proportion is bounded below by `lower`.
	// It's too hard to level up with a > 0.9 test when incorrect > 0.
	return lower > 0.875
}

func IsTooHard(correct, incorrect int) bool {
	z := 3.1 // z-score for one-sided confidence interval
	upper := Wilson(correct, incorrect, z)

	// 99.9% confident that the true proportion is bounded above by `upper`.
	return upper < 0.8
}
