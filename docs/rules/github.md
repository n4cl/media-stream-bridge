# GitHub運用ルール

## 目的

GitHub上で変更を追跡し、作業ブランチとPull Requestを一つの変更目的に結び付ける。一方で、小さく自明な変更に形式的なIssueを要求しない。

変更目的や受け入れ条件の正本は [`information-lifecycle.md`](information-lifecycle.md) に従って選ぶ。この文書では、その判断をGitHub上の作業へ適用する方法を定める。

## Issueを作る基準

次のいずれかに当てはまる変更は、実装前にIssueを作る。

- 優先順位を付け、着手前の課題として管理する必要がある
- 背景、目的、受け入れ条件、対象外を合意する必要がある
- 複数のコミットやPull Requestへ分かれる可能性がある
- 実装前の検討、採用しなかった案、未解決事項を残す必要がある
- 不具合の再現条件や影響範囲を追跡する必要がある

小さく自明で、変更目的をPull Requestまたはコミットだけで十分に説明できる変更では、Issueを省略できる。形式を整えるためだけに、完了後のIssueを作らない。

## ブランチ

- `main`はリリース済みの状態を保持する。
- `develop`は次回リリースへ向けた変更の統合先とする。
- 通常の作業ブランチは`develop`から作成し、一つの変更目的だけを扱う。
- Issueがある場合は、ブランチ名へIssue番号を含める。

ブランチ名は次を基本とする。

```text
feature/<Issue番号>-<短い名前>
fix/<Issue番号>-<短い名前>
feature/<短い名前>  # Issueを省略した場合
fix/<短い名前>      # Issueを省略した場合
```

## Pull Request

- 通常の作業ブランチは`develop`へPull Requestを作る。
- Issueがある場合はPull Requestから参照し、その変更だけでIssueを完了できる場合は自動クローズできる形で関連付ける。
- Issueを省略した場合は、必要に応じてPull Requestを変更目的と検証結果の正本にする。
- リリース時は`develop`から`main`へPull Requestを作り、反映後の`main`へバージョンタグを付ける。

## Issueテンプレート

Issueテンプレートは `.github/ISSUE_TEMPLATE/` で管理する。GitHub上で利用できるのはデフォルトブランチへ反映されたテンプレートだけである。
